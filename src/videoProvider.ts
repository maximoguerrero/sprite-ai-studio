import type { ProviderProfile } from "./types";
import { providerCall, proxyFetch } from "./openAIProvider";

export type VideoPollResult = {
  status: string;
  videoUrl?: string;
  progress?: number;
  errorCode?: string;
  errorMessage?: string;
};

export async function submitVideoGeneration(
  profile: ProviderProfile,
  request: {
    model: string;
    prompt: string;
    duration: number;
    aspectRatio?: string;
    resolution?: string;
    imageDataUrl?: string;
    lastFrameDataUrl?: string;
  }
) {
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    duration: request.duration,
    aspect_ratio: request.aspectRatio ?? "1:1",
    resolution: request.resolution ?? "480p",
    generate_audio: false,
  };
  if (request.imageDataUrl) body.image = { url: request.imageDataUrl };
  if (request.lastFrameDataUrl) body.last_frame = { url: request.lastFrameDataUrl };
  const result = (await providerCall(profile, "/v1/videos/generations", "POST", body)) as {
    request_id?: string;
    id?: string;
  };
  const requestId = result.request_id ?? result.id;
  if (!requestId) throw new Error("The video submission did not return a request id.");
  return requestId;
}

export async function pollVideoGeneration(profile: ProviderProfile, requestId: string): Promise<VideoPollResult> {
  const result = (await providerCall(profile, `/v1/videos/${encodeURIComponent(requestId)}`, "GET")) as {
    status?: string;
    progress?: number;
    video?: { url?: string; duration?: number };
    video_url?: string;
    providerMetadata?: { xai?: { videoUrl?: string } };
    error?: { code?: string; message?: string };
  };
  return {
    status: result.status ?? "unknown",
    videoUrl: result.video?.url ?? result.video_url ?? result.providerMetadata?.xai?.videoUrl,
    progress: result.progress,
    errorCode: result.error?.code,
    errorMessage: result.error?.message,
  };
}

export async function downloadVideoBlob(_profile: ProviderProfile, url: string) {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const encoded = await invoke<string>("download_grok_image", { url });
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: "video/mp4" });
  }
  const response = await proxyFetch(url);
  if (!response.ok) throw new Error("Could not download the generated video from the provider response.");
  return response.blob();
}

export const videoRatesUsdPerSecond: Record<string, number> = {
  "grok-imagine-video-1.5": 0.08,
  "grok-imagine-video-1.5-lite": 0.02,
  "grok-imagine-video": 0.05,
};

export function supportsFramePinning(model: string) {
  return model === "grok-imagine-video-1.5";
}

export function videoCostUsd(model: string, duration: number) {
  return (videoRatesUsdPerSecond[model] ?? 0.05) * duration;
}

export function videoErrorMessage(code?: string, message?: string) {
  const detail = message ?? "unknown error";
  switch (code) {
    case "rate-limit":
      return "xAI rate limit reached. Try again in a moment.";
    case "content-moderation":
    case "moderation":
      return "xAI moderation rejected this prompt. Soften the wording and try again.";
    case "invalid-request":
    case "invalid_request":
      return `xAI rejected the request: ${detail}`;
    case "quota-exceeded":
    case "insufficient-credits":
      return "xAI account has no remaining credits for video generation.";
    default:
      return `xAI video generation failed${code ? ` (${code})` : ""}: ${detail}`;
  }
}

export async function waitForVideo(
  profile: ProviderProfile,
  requestId: string,
  options: { onProgress?: (progress: number) => void; signal?: AbortSignal; timeoutMs?: number }
): Promise<string> {
  const deadline = Date.now() + (options.timeoutMs ?? 600_000);
  for (;;) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise((resolve) => setTimeout(resolve, 4000));
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await pollVideoGeneration(profile, requestId);
    if (result.status === "failed") throw new Error(videoErrorMessage(result.errorCode, result.errorMessage));
    if (result.status === "done" && result.videoUrl) return result.videoUrl;
    if (result.status === "done") throw new Error("xAI reported the video as done but returned no download URL.");
    options.onProgress?.(typeof result.progress === "number" ? result.progress : 0);
    if (Date.now() > deadline) throw new Error("xAI video generation timed out after 10 minutes.");
  }
}
