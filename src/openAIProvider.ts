import type { ProviderProfile } from "./types";
import { getProviderSecret } from "./providerSecrets";
import {
  collectImageCandidates,
  decodeBase64Image,
  describeResponseShape,
  isHttpImageReference,
  revisedPromptFrom,
} from "./lib/imageResponse";

function endpoint(baseUrl: string, path: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}${path.slice(3)}` : `${base}${path}`;
}

function proxyBaseUrl() {
  if (import.meta.env.DEV) return "";
  return String(import.meta.env.VITE_PROVIDER_PROXY ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
}

export async function proxyFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Provider-Target", url);
  return fetch(`${proxyBaseUrl()}/__provider-proxy`, { ...init, headers });
}

async function authorizedFetch(profile: ProviderProfile, path: string, init: RequestInit = {}) {
  const apiKey = await getProviderSecret(profile.id);
  const response = await proxyFetch(endpoint(profile.baseUrl, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 600);
    throw new Error(`Provider returned ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response;
}

export async function providerCall(
  profile: ProviderProfile,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  signal?: AbortSignal
) {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<unknown>("provider_api_request", {
      profileId: profile.id,
      baseUrl: profile.baseUrl,
      path,
      body: body ?? null,
    });
  }
  if (!/^https?:\/\//i.test(profile.baseUrl)) {
    throw new Error("Provider URL must use HTTP or HTTPS.");
  }
  const response = await authorizedFetch(profile, path, {
    method,
    signal,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return response.json() as Promise<unknown>;
}

export type ProviderModelInfo = { id: string; kind: "image" | "text" | "video" };

export const grokKnownModels: ProviderModelInfo[] = [
  { id: "grok-imagine-image-2.0", kind: "image" },
  { id: "grok-imagine-image-quality", kind: "image" },
  { id: "grok-imagine-image", kind: "image" },
  { id: "grok-imagine-video-1.5-lite", kind: "video" },
  { id: "grok-imagine-video-1.5", kind: "video" },
  { id: "grok-imagine-video", kind: "video" },
];

function isVideoCapableModel(entry: { id: string }) {
  return /grok-imagine-video|[-_]video[-_]|[-_]sora|veo|kling|wan[-_]/i.test(entry.id);
}

function isImageCapableModel(entry: { id: string; architecture?: { output_modalities?: unknown } }) {
  const modalities = entry.architecture?.output_modalities;
  if (Array.isArray(modalities) && modalities.includes("image")) return true;
  return /image|flux|stable[-_]?diffusion|sd[-_]?xl|dall|imagen|photon|seedream/i.test(entry.id);
}

export async function testProviderConnection(profile: ProviderProfile) {
  if (profile.providerType === "parley") {
    return { modelsList: false, models: [] as string[], modelDetails: [] as ProviderModelInfo[] };
  }
  const payload = (await providerCall(profile, "/v1/models", "GET").catch((error) => {
    if (
      profile.providerType === "grok" &&
      /403|permission-denied/i.test(error instanceof Error ? error.message : String(error))
    )
      return null;
    throw error;
  })) as { data?: Array<{ id?: string; architecture?: { output_modalities?: unknown } }> } | null;
  if (!payload)
    return {
      modelsList: false,
      models: grokKnownModels.map((model) => model.id),
      modelDetails: grokKnownModels,
      modelsBlocked: true,
    };
  const entries = Array.isArray(payload.data)
    ? payload.data.filter(
        (item): item is { id: string; architecture?: { output_modalities?: unknown } } => typeof item.id === "string"
      )
    : [];
  const modelDetails: ProviderModelInfo[] = entries.map((entry) => ({
    id: entry.id,
    kind: isVideoCapableModel(entry) ? "video" : isImageCapableModel(entry) ? "image" : "text",
  }));
  return { modelsList: true, models: modelDetails.map((entry) => entry.id), modelDetails };
}

export function imageModelFor(profile: ProviderProfile) {
  return profile.imageModel?.trim() || profile.model;
}

export async function generateText(
  profile: ProviderProfile,
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal?: AbortSignal
) {
  const payload = (await providerCall(
    profile,
    "/v1/chat/completions",
    "POST",
    { model: profile.model, messages },
    signal
  )) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("The text model returned no content.");
  return content;
}

export async function generateImage(
  profile: ProviderProfile,
  request: {
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    transparentBackground?: boolean;
    quality?: "low" | "medium" | "high" | "auto";
    referenceImage?: Blob;
    referenceImages?: Blob[];
    signal?: AbortSignal;
  }
) {
  const referenceImages = [
    ...(request.referenceImage ? [request.referenceImage] : []),
    ...(request.referenceImages ?? []),
  ];
  if (referenceImages.length) {
    if (profile.capabilities?.imageToImage === false)
      throw new Error("Image-to-image is disabled for this provider profile.");
    return editImage(profile, { ...request, referenceImages });
  }
  const aspect = request.width / request.height;
  const providerSize =
    profile.providerType === "parley"
      ? aspect > 1.2
        ? "1536x1024"
        : aspect < 0.83
          ? "1024x1536"
          : "1024x1024"
      : aspect > 1.2
        ? "1536x1024"
        : aspect < 0.83
          ? "1024x1536"
          : "1024x1024";
  const imageModel = imageModelFor(profile);
  const model = profile.providerType === "parley" && !imageModel.includes("/") ? `openai/${imageModel}` : imageModel;
  const body = {
    model,
    prompt: request.negativePrompt ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}` : request.prompt,
    ...(profile.providerType === "grok" ? {} : { size: providerSize, n: 1 }),
    ...(profile.providerType === "parley"
      ? { quality: request.quality ?? "auto" }
      : profile.providerType === "grok"
        ? {}
        : /^dall[-e]/i.test(imageModel)
          ? { response_format: "b64_json" }
          : {}),
    ...(request.transparentBackground && profile.providerType !== "grok" && profile.capabilities?.transparency
      ? { background: "transparent" }
      : {}),
  };
  const result = await providerCall(
    profile,
    "/v1/images/generations",
    "POST",
    {
      ...body,
    },
    request.signal
  );
  return decodeImageResult(profile, result, "Provider response did not include an image.");
}

async function editImage(
  profile: ProviderProfile,
  request: {
    prompt: string;
    width: number;
    height: number;
    quality?: "low" | "medium" | "high" | "auto";
    referenceImages: Blob[];
  }
) {
  const model = profile.providerType === "grok" ? "grok-imagine-image-2.0" : imageModelFor(profile);
  if (profile.providerType === "grok") {
    const image = request.referenceImages[0];
    if (request.referenceImages.length > 1)
      throw new Error(
        "Grok image edits accept one input image. To keep the anchor and animation sheet as separate references, use an OpenAI-compatible image-edit endpoint."
      );
    const dataUri = await blobToDataUrl(image);
    const payload = await providerCall(profile, "/v1/images/edits", "POST", {
      model,
      prompt: request.prompt,
      image: { url: dataUri, type: "image_url" },
    });
    return decodeImageResult(profile, payload, "Provider edit response did not contain image data.");
  }
  if (profile.providerType === "parley")
    throw new Error(
      "Parley image edits are not documented in the supplied API reference. Use a provider with image-edit support."
    );
  if (request.referenceImages.length > 1 && request.referenceImages.some((image) => image.type === "image/webp"))
    throw new Error(
      "OpenAI image edits support PNG and JPEG references for multi-image requests. Convert the animation sheet to PNG or JPEG and retry."
    );
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const encodedImages = await Promise.all(
      request.referenceImages.map(async (image) => {
        const dataUri = await blobToDataUrl(image);
        return { image_base64: dataUri.split(",", 2)[1], image_mime: image.type || "image/png" };
      })
    );
    const payload = await invoke<unknown>("provider_api_request", {
      profileId: profile.id,
      baseUrl: profile.baseUrl,
      path: "/v1/images/edits",
      body: { model: imageModelFor(profile), prompt: request.prompt, images: encodedImages },
    });
    return decodeImageResult(profile, payload, "Provider edit response did not contain image data.");
  }

  const key = await getProviderSecret(profile.id);
  const form = new FormData();
  form.append("model", imageModelFor(profile));
  form.append("prompt", request.prompt);
  for (const [index, image] of request.referenceImages.entries())
    form.append(
      request.referenceImages.length === 1 ? "image" : "image[]",
      image,
      `reference-${index + 1}.${image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png"}`
    );
  const response = await proxyFetch(endpoint(profile.baseUrl, "/v1/images/edits"), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload: unknown = await response.json();
  return decodeImageResult(profile, payload, "Provider edit response did not contain image data.");
}

async function decodeImageResult(profile: ProviderProfile, payload: unknown, failureMessage: string) {
  const revisedPrompt = revisedPromptFrom(payload);
  for (const candidate of [...new Set(collectImageCandidates(payload))]) {
    if (isHttpImageReference(candidate)) {
      if (window.__TAURI_INTERNALS__) {
        if (profile.providerType !== "grok")
          throw new Error("Desktop provider responses must include base64 image data, not an image URL.");
        const { invoke } = await import("@tauri-apps/api/core");
        const encoded = await invoke<string>("download_grok_image", { url: candidate });
        const decoded = decodeBase64Image(encoded);
        if (decoded) return { blob: new Blob([decoded.bytes], { type: decoded.mime }), revisedPrompt };
        continue;
      }
      const response = await proxyFetch(candidate);
      if (!response.ok) throw new Error("Could not download the generated image from the provider response.");
      const blob = await response.blob();
      if (blob.size) return { blob, revisedPrompt };
      continue;
    }
    const decoded = decodeBase64Image(candidate);
    if (decoded) return { blob: new Blob([decoded.bytes], { type: decoded.mime }), revisedPrompt };
  }
  throw new Error(`${failureMessage} The provider returned ${describeResponseShape(payload)}.`);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not encode reference image."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read reference image."));
    reader.readAsDataURL(blob);
  });
}
