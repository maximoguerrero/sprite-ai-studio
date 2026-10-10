import { zipSync } from "fflate";
import gifenc from "gifenc";
import UPNG from "upng-js";
import type { StudioFrame } from "./types";

type GifColor = number[];
type GifPalette = GifColor[];
type GifEncoder = { writeFrame(index: Uint8Array, width: number, height: number, options: { palette?: GifPalette; transparent?: boolean; transparentIndex?: number; delay?: number; repeat?: number; dispose?: number }): void; finish(): void; bytes(): Uint8Array };
type GifApi = { GIFEncoder(): GifEncoder; applyPalette(data: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: string): Uint8Array; quantize(data: Uint8Array, maxColors: number, options?: { format?: string; oneBitAlpha?: boolean }): GifPalette };
const typedGifenc = gifenc as unknown as GifApi;

export type ExportFrame = StudioFrame & { image: HTMLImageElement };
export type SheetAtlasFrame = { filename: string; frame: { x: number; y: number; w: number; h: number }; duration: number; pivot: { x: number; y: number } };
export type ExportAnimation = {
  id: string;
  name: string;
  fps: number;
  loop: boolean;
  width: number;
  height: number;
  frames: ExportFrame[];
  cardVersionId?: string;
  anchorVersionId?: string;
};

export type CombinedLayout = "vertical" | "horizontal" | "grid";
export type FrameLayout = "horizontal" | "grid";

export function frameImagePlacement(frame: Pick<StudioFrame, "offsetX" | "offsetY">, width: number, height: number, imageWidth: number, imageHeight: number, originX = 0, originY = 0) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  return {
    x: originX + (width - drawWidth) / 2 + frame.offsetX,
    y: originY + (height - drawHeight) / 2 + frame.offsetY,
    width: drawWidth,
    height: drawHeight,
  };
}

export function renderFrame(frame: ExportFrame, width: number, height: number, context: CanvasRenderingContext2D, originX = 0, originY = 0) {
  const rect = frameImagePlacement(frame, width, height, frame.image.naturalWidth, frame.image.naturalHeight, originX, originY);
  context.drawImage(frame.image, rect.x, rect.y, rect.width, rect.height);
}

export function renderSheet(frames: ExportFrame[], width: number, height: number, columns = frames.length, padding = 0) {
  if (frames.length === 0) throw new Error("Add at least one frame before exporting.");
  const safeColumns = Math.max(1, Math.min(Math.floor(columns), frames.length));
  const rows = Math.ceil(frames.length / safeColumns);
  const gap = Math.max(0, Math.round(padding));
  const canvas = document.createElement("canvas");
  canvas.width = safeColumns * width + Math.max(0, safeColumns - 1) * gap;
  canvas.height = rows * height + Math.max(0, rows - 1) * gap;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
  context.imageSmoothingEnabled = false;
  const atlasFrames = frames.map((frame, index) => {
    const x = (index % safeColumns) * (width + gap);
    const y = Math.floor(index / safeColumns) * (height + gap);
    renderFrame(frame, width, height, context, x, y);
    return {
      filename: frame.name,
      frame: { x, y, w: width, h: height },
      duration: frame.durationMs,
      pivot: { x: frame.pivotX, y: frame.pivotY },
    } satisfies SheetAtlasFrame;
  });
  return { canvas, atlasFrames };
}

export function renderCombinedSheet(
  animations: ExportAnimation[],
  layout: CombinedLayout,
  padding: number,
) {
  if (animations.length === 0 || animations.some((animation) => animation.frames.length === 0)) {
    throw new Error("Choose at least one animation card with imported frames.");
  }
  const gap = Math.max(0, Math.round(padding));
  const blockSizes = animations.map(({ frames, width: frameWidth, height: frameHeight }) => ({ width: frames.length * frameWidth, height: frameHeight }));
  let columns: number;
  let rows: number;
  if (layout === "vertical") { columns = 1; rows = animations.length; }
  else if (layout === "horizontal") { columns = animations.length; rows = 1; }
  else { columns = Math.ceil(Math.sqrt(animations.length)); rows = Math.ceil(animations.length / columns); }
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(0, ...blockSizes.filter((_, index) => index % columns === column).map((size) => size.width)));
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0, ...blockSizes.filter((_, index) => Math.floor(index / columns) === row).map((size) => size.height)));
  const canvas = document.createElement("canvas");
  canvas.width = columnWidths.reduce((sum, item) => sum + item, 0) + gap * Math.max(0, columns - 1);
  canvas.height = rowHeights.reduce((sum, item) => sum + item, 0) + gap * Math.max(0, rows - 1);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
  context.imageSmoothingEnabled = false;
  const columnOffsets = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, item) => sum + item + gap, 0));
  const rowOffsets = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, item) => sum + item + gap, 0));
  const animationsManifest = animations.map((animation, animationIndex) => {
    const column = animationIndex % columns;
    const row = Math.floor(animationIndex / columns);
    const blockX = columnOffsets[column];
    const blockY = rowOffsets[row];
    const animationWidth = animation.width;
    const animationHeight = animation.height;
    const frames = animation.frames.map((frame, frameIndex) => {
      const x = blockX + frameIndex * animationWidth;
      const y = blockY;
      renderFrame(frame, animationWidth, animationHeight, context, x, y);
      return { filename: frame.name, frame: { x, y, w: animationWidth, h: animationHeight }, duration: frame.durationMs, pivot: { x: frame.pivotX, y: frame.pivotY } } satisfies SheetAtlasFrame;
    });
    return { id: animation.id, name: animation.name, cardVersionId: animation.cardVersionId, anchorVersionId: animation.anchorVersionId, fps: animation.fps, loop: animation.loop, frameWidth: animationWidth, frameHeight: animationHeight, frames };
  });
  return { canvas, animations: animationsManifest };
}

export function renderAnimationFrames(frames: ExportFrame[], width: number, height: number) {
  if (frames.length === 0) throw new Error("Add at least one frame before exporting.");
  return frames.map((frame) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const frameContext = canvas.getContext("2d");
    if (!frameContext) throw new Error("Canvas rendering is unavailable in this browser.");
    frameContext.imageSmoothingEnabled = false;
    renderFrame(frame, width, height, frameContext);
    return { frame, canvas };
  });
}

export function encodeGif(frames: ReturnType<typeof renderAnimationFrames>, loop: boolean) {
  if (!frames.length) throw new Error("Add at least one frame before exporting.");
  const gif = typedGifenc.GIFEncoder();
  let globalPalette: GifPalette | undefined;
  const rgbaFrames = frames.map(({ canvas }) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  });
  const paletteData = new Uint8Array(rgbaFrames.reduce((count, data) => count + data.length, 0));
  let cursor = 0;
  for (const data of rgbaFrames) { paletteData.set(data, cursor); cursor += data.length; }
  globalPalette = typedGifenc.quantize(paletteData, 256, { format: "rgba4444", oneBitAlpha: true });
  frames.forEach(({ frame, canvas }, index) => {
    const indexed = typedGifenc.applyPalette(rgbaFrames[index], globalPalette!, "rgba4444");
    const transparentIndex = globalPalette!.findIndex((color) => (color[3] ?? 255) < 128);
    gif.writeFrame(indexed, canvas.width, canvas.height, {
      palette: globalPalette,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      delay: Math.max(10, Math.round(frame.durationMs / 10) * 10),
      repeat: loop ? 0 : -1,
      dispose: 2,
    });
  });
  gif.finish();
  return gif.bytes();
}

export function encodeApng(frames: ReturnType<typeof renderAnimationFrames>, loop: boolean) {
  if (!frames.length) throw new Error("Add at least one frame before exporting.");
  const { width, height } = frames[0].canvas;
  const imageData = frames.map(({ canvas }) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
    return context.getImageData(0, 0, width, height).data.buffer;
  });
  const encoded = new Uint8Array(UPNG.encode(imageData, width, height, 0, frames.map(({ frame }) => frame.durationMs)));
  const animationChunk = new TextDecoder().decode(encoded).indexOf("acTL");
  if (animationChunk >= 0) new DataView(encoded.buffer, encoded.byteOffset + animationChunk + 8, 4).setUint32(0, loop ? 0 : 1);
  return encoded;
}

export async function encodeAnimatedWebp(frames: ReturnType<typeof renderAnimationFrames>, loop: boolean) {
  if (!frames.length) throw new Error("Add at least one frame before exporting.");
  const { width, height } = frames[0].canvas;
  const webpFrames = frames.map(({ canvas, frame }) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
    return { data: new Uint8Array(context.getImageData(0, 0, width, height).data), duration: frame.durationMs, config: { lossless: 1, quality: 100 } };
  });
  const webp = await import("wasm-webp");
  const encoded = await webp.encodeAnimation(width, height, true, webpFrames);
  if (!encoded) throw new Error("Animated WebP encoding failed.");
  const bytes = new Uint8Array(encoded);
  const animationChunk = new TextDecoder().decode(bytes).indexOf("ANIM");
  if (animationChunk >= 0 && animationChunk + 10 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + animationChunk + 8, 2);
    view.setUint16(0, loop ? 0 : 1, true);
  }
  return bytes;
}

export function framesToZip(files: Array<{ name: string; data: Uint8Array }>) {
  return zipSync(Object.fromEntries(files.map(({ name, data }) => [name, data])), { level: 6 });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create PNG export.")), "image/png");
  });
}

export function safeFilename(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sprite";
}
