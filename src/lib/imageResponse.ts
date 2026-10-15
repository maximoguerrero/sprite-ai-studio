// Providers disagree on where a finished image lives in a response: OpenAI uses
// data[0].b64_json, other gateways use images[0], output[], or inline a data: URL.
// These helpers are pure so the shapes can be covered without a live provider.

type ImageResponseEntry = {
  b64_json?: unknown;
  image_base64?: unknown;
  base64?: unknown;
  image_url?: unknown;
  url?: unknown;
  src?: unknown;
  image?: unknown;
  output?: unknown;
  data?: unknown;
  revised_prompt?: unknown;
};

export const IMAGE_RESPONSE_CONTAINER_KEYS = ["data", "images", "results", "items", "output", "artifacts"];

export function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function entryImageValues(entry: ImageResponseEntry): string[] {
  const nested = entry.image_url ?? entry.image;
  const nestedUrl = nested && typeof nested === "object" ? trimmedString((nested as { url?: unknown }).url) : undefined;
  return [
    trimmedString(entry.b64_json),
    trimmedString(entry.image_base64),
    trimmedString(entry.base64),
    nestedUrl,
    trimmedString(entry.url),
    trimmedString(entry.src),
    trimmedString(entry.image),
    trimmedString(entry.data),
    trimmedString(entry.output),
  ].filter((value): value is string => Boolean(value));
}

export function collectImageCandidates(payload: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof payload === "string") {
    const value = trimmedString(payload);
    return value ? [value] : [];
  }
  if (Array.isArray(payload)) return payload.flatMap((item) => collectImageCandidates(item, depth + 1));
  if (!payload || typeof payload !== "object") return [];
  const entry = payload as ImageResponseEntry;
  const values = entryImageValues(entry);
  for (const key of IMAGE_RESPONSE_CONTAINER_KEYS) {
    const nested = entry[key as keyof ImageResponseEntry];
    if (nested !== undefined && nested !== null) values.push(...collectImageCandidates(nested, depth + 1));
  }
  return values;
}

export function revisedPromptFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const direct = trimmedString((payload as ImageResponseEntry).revised_prompt);
  if (direct) return direct;
  for (const key of IMAGE_RESPONSE_CONTAINER_KEYS) {
    const container = (payload as Record<string, unknown>)[key];
    if (!Array.isArray(container)) continue;
    for (const item of container) {
      if (!item || typeof item !== "object") continue;
      const nested = trimmedString((item as ImageResponseEntry).revised_prompt);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function isHttpImageReference(value: string) {
  return /^https?:\/\//i.test(value);
}

export function decodeBase64Image(value: string): { bytes: Uint8Array; mime: string } | null {
  const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(value);
  const base64 = (dataUrl?.[2] ?? value).replace(/\s+/g, "");
  if (base64.length < 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime: dataUrl?.[1] ?? "image/png" };
  } catch {
    return null;
  }
}

export function describeResponseShape(payload: unknown): string {
  if (Array.isArray(payload)) return "an array";
  if (payload && typeof payload === "object") {
    const keys = Object.keys(payload as Record<string, unknown>);
    return keys.length ? `keys: ${keys.slice(0, 8).join(", ")}` : "an empty object";
  }
  return typeof payload;
}
