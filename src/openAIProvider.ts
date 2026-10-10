import type { ProviderProfile } from "./types";
import { getProviderSecret } from "./providerSecrets";

function endpoint(baseUrl: string, path: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}${path.slice(3)}` : `${base}${path}`;
}

async function authorizedFetch(profile: ProviderProfile, path: string, init: RequestInit = {}) {
  const apiKey = await getProviderSecret(profile.id);
  const response = await fetch(endpoint(profile.baseUrl, path), {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 600);
    throw new Error(`Provider returned ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response;
}

async function providerCall(profile: ProviderProfile, path: string, method: "GET" | "POST", body?: unknown, signal?: AbortSignal) {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<unknown>("provider_api_request", { profileId: profile.id, baseUrl: profile.baseUrl, path, body: body ?? null });
  }
  if (!profile.baseUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(profile.baseUrl)) {
    throw new Error("Provider URL must use HTTPS except for localhost.");
  }
  const response = await authorizedFetch(profile, path, { method, signal, ...(body ? { body: JSON.stringify(body) } : {}) });
  return response.json() as Promise<unknown>;
}

export async function testProviderConnection(profile: ProviderProfile) {
  if (profile.providerType === "parley" || profile.providerType === "grok") {
    return { modelsList: false, models: [] as string[] };
  }
  const payload = await providerCall(profile, "/v1/models", "GET") as { data?: Array<{ id?: string }> };
  const models = Array.isArray(payload.data) ? payload.data.map((item) => item.id).filter((id): id is string => Boolean(id)) : [];
  return { modelsList: true, models };
}

export async function generateImage(profile: ProviderProfile, request: {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  transparentBackground?: boolean;
  quality?: "low" | "medium" | "high" | "auto";
  referenceImage?: Blob;
  signal?: AbortSignal;
}) {
  if (request.referenceImage) {
    if (profile.capabilities?.imageToImage === false) throw new Error("Image-to-image is disabled for this provider profile.");
    return editImage(profile, { ...request, referenceImage: request.referenceImage });
  }
  const aspect = request.width / request.height;
  const providerSize = profile.providerType === "parley"
    ? aspect > 1.2 ? "1536x1024" : aspect < 0.83 ? "1024x1536" : "1024x1024"
    : aspect > 1.2 ? "1536x1024" : aspect < 0.83 ? "1024x1536" : "1024x1024";
  const model = profile.providerType === "parley" && !profile.model.includes("/") ? `openai/${profile.model}` : profile.model;
  const body = {
    model,
    prompt: request.negativePrompt ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}` : request.prompt,
    ...(profile.providerType === "grok" ? {} : { size: providerSize, n: 1 }),
    ...(profile.providerType === "parley" ? { quality: request.quality ?? "auto" } : profile.providerType === "grok" ? {} : { response_format: "b64_json" }),
    ...(request.transparentBackground && profile.providerType !== "grok" && profile.capabilities?.transparency ? { background: "transparent" } : {}),
  };
  const result = await providerCall(profile, "/v1/images/generations", "POST", {
    ...body,
  }, request.signal) as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
  const image = result.data?.[0];
  if (!image) throw new Error("Provider response did not include an image.");
  if (image.b64_json) {
    const binary = atob(image.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { blob: new Blob([bytes], { type: "image/png" }), revisedPrompt: image.revised_prompt };
  }
  if (image.url) {
    if (window.__TAURI_INTERNALS__) {
      const { invoke } = await import("@tauri-apps/api/core");
      const encoded = await invoke<string>("download_grok_image", { url: image.url });
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { blob: new Blob([bytes], { type: "image/png" }), revisedPrompt: image.revised_prompt };
    }
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) throw new Error("Could not download the generated image from the provider response.");
    return { blob: await imageResponse.blob(), revisedPrompt: image.revised_prompt };
  }
  throw new Error("Provider returned neither b64_json nor an image URL. Configure a compatible image response format.");
}

async function editImage(profile: ProviderProfile, request: { prompt: string; width: number; height: number; quality?: "low" | "medium" | "high" | "auto"; referenceImage: Blob }) {
  const model = profile.providerType === "grok" ? "grok-imagine-image-2.0" : profile.model;
  if (profile.providerType === "grok") {
    const dataUri = await blobToDataUrl(request.referenceImage);
    const payload = await providerCall(profile, "/v1/images/edits", "POST", { model, prompt: request.prompt, image: { url: dataUri, type: "image_url" } }) as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
    return decodeImageResult(profile, payload.data?.[0]);
  }
  if (profile.providerType === "parley") throw new Error("Parley image edits are not documented in the supplied API reference. Use a provider with image-edit support.");
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const dataUri = await blobToDataUrl(request.referenceImage);
    const [, encoded] = dataUri.split(",", 2);
    const payload = await invoke<unknown>("provider_api_request", {
      profileId: profile.id,
      baseUrl: profile.baseUrl,
      path: "/v1/images/edits",
      body: { model: profile.model, prompt: request.prompt, image_base64: encoded, image_mime: request.referenceImage.type || "image/png", image_filename: "reference.png" },
    }) as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
    return decodeImageResult(profile, payload.data?.[0]);
  }

  const key = await getProviderSecret(profile.id);
  const form = new FormData();
  form.append("model", profile.model);
  form.append("prompt", request.prompt);
  form.append("image", request.referenceImage, "reference.png");
  const response = await fetch(endpoint(profile.baseUrl, "/v1/images/edits"), { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
  return decodeImageResult(profile, payload.data?.[0]);
}

async function decodeImageResult(profile: ProviderProfile, image?: { b64_json?: string; url?: string; revised_prompt?: string }) {
  if (image?.b64_json) {
    const binary = atob(image.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { blob: new Blob([bytes], { type: "image/png" }), revisedPrompt: image.revised_prompt };
  }
  if (image?.url) {
    if (window.__TAURI_INTERNALS__) {
      if (profile.providerType !== "grok") throw new Error("Desktop edit response returned a URL instead of base64 image data.");
      const { invoke } = await import("@tauri-apps/api/core");
      const encoded = await invoke<string>("download_grok_image", { url: image.url });
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { blob: new Blob([bytes], { type: "image/png" }), revisedPrompt: image.revised_prompt };
    }
    const response = await fetch(image.url);
    if (!response.ok) throw new Error("Could not download image edit result.");
    return { blob: await response.blob(), revisedPrompt: image.revised_prompt };
  }
  throw new Error("Provider edit response did not contain image data.");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not encode reference image."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read reference image."));
    reader.readAsDataURL(blob);
  });
}
