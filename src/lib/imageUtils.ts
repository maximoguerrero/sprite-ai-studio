import { animationStripCrop } from "../animationSheet";

export async function splitAnimationStrip(source: Blob, frameCount = 8, frameSize = 256) {
  const bitmap = await createImageBitmap(source);
  const frames: Blob[] = [];
  try {
    for (let index = 0; index < frameCount; index++) {
      const crop = animationStripCrop(bitmap.width, bitmap.height, index, frameCount);
      const canvas = document.createElement("canvas");
      canvas.width = frameSize;
      canvas.height = frameSize;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare animation frame canvases.");
      context.imageSmoothingEnabled = false;
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, frameSize, frameSize);
      frames.push(
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error(`Could not extract animation frame ${index + 1}.`))),
            "image/png"
          )
        )
      );
    }
  } finally {
    bitmap.close();
  }
  return frames;
}

export async function flattenImageOnColor(source: Blob, color: string): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image canvas is unavailable.");
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not flatten image onto background color."))),
      "image/png"
    )
  );
}

export async function removeGreenScreen(source: Blob, threshold = 45, softness = 45): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image canvas is unavailable.");
  context.drawImage(bitmap, 0, 0);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;
  const edge = Math.max(0, threshold - softness);
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const greenness = g - Math.max(r, b);
    if (greenness >= threshold) {
      pixels[index + 3] = 0;
    } else if (greenness > edge) {
      const blend = (greenness - edge) / (threshold - edge);
      pixels[index + 3] = Math.round(pixels[index + 3] * (1 - blend));
      pixels[index + 1] = Math.min(g, Math.max(r, b) + edge);
    }
  }
  context.putImageData(frame, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not key out the green screen."))),
      "image/png"
    )
  );
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not encode backup image."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read backup image."));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string, fallbackType: string): Blob {
  const [metadata, encoded] = dataUrl.split(",", 2);
  if (!metadata || !encoded) throw new Error("Invalid image data in workspace backup.");
  const mime = metadata.match(/^data:([^;]+)/)?.[1] ?? fallbackType;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export async function normalizeGeneratedImage(source: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image canvas is unavailable.");
  context.imageSmoothingEnabled = false;
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not normalize generated image."))),
      "image/png"
    )
  );
}

export async function createFlatThumbnail(sources: Blob[], maxSize = 256): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = maxSize;
  canvas.height = maxSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare thumbnail canvas.");
  context.imageSmoothingEnabled = false;
  for (const source of sources) {
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(maxSize / bitmap.width, maxSize / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, (maxSize - drawWidth) / 2, (maxSize - drawHeight) / 2, drawWidth, drawHeight);
    bitmap.close();
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create flat thumbnail."))), "image/png")
  );
}

export async function convertImageToPng(source: Blob): Promise<Blob> {
  if (source.type === "image/png") return source;
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Could not prepare timeline reference images.");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not convert a timeline reference to PNG."))),
      "image/png"
    )
  );
}
