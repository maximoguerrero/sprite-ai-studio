import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync } from "fflate";
import { frameImagePlacement, framesToZip, renderFrame, renderSheet, type ExportFrame } from "./spriteSheet.ts";

test("preview/export placement uses centered fit and the same pixel offsets", () => {
  const frame = { id: "one", imageKey: "one", name: "one.png", offsetX: 3, offsetY: -2, pivotX: 32, pivotY: 60, durationMs: 100, image: { naturalWidth: 32, naturalHeight: 16 } } as ExportFrame;
  const preview = frameImagePlacement(frame, 64, 64, 32, 16);
  const calls: unknown[][] = [];
  const context = { drawImage: (...args: unknown[]) => calls.push(args) } as unknown as CanvasRenderingContext2D;
  renderFrame(frame, 64, 64, context);
  const exportPlacement = calls[0].slice(1);
  assert.deepEqual(preview, { x: 3, y: 14, width: 64, height: 32 });
  assert.deepEqual(exportPlacement, [preview.x, preview.y, preview.width, preview.height]);
});

test("frame sheet cells and atlas coordinates include inter-frame padding", () => {
  const calls: unknown[][] = [];
  const context = { imageSmoothingEnabled: true, drawImage: (...args: unknown[]) => calls.push(args) } as unknown as CanvasRenderingContext2D;
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => canvas } as unknown as Document;
  const frames = [
    { id: "one", imageKey: "one", name: "one.png", offsetX: 2, offsetY: 1, pivotX: 32, pivotY: 60, durationMs: 100, image: { naturalWidth: 64, naturalHeight: 64 } },
    { id: "two", imageKey: "two", name: "two.png", offsetX: -1, offsetY: 0, pivotX: 30, pivotY: 60, durationMs: 120, image: { naturalWidth: 64, naturalHeight: 64 } },
  ] as ExportFrame[];
  try {
    const { canvas: sheet, atlasFrames } = renderSheet(frames, 64, 64, 2, 4);
    assert.equal(sheet.width, 132);
    assert.equal(sheet.height, 64);
    assert.equal(atlasFrames[0].frame.x, 0);
    assert.equal(atlasFrames[1].frame.x, 68);
    assert.deepEqual(calls.map((call) => call.slice(1)), [[2, 1, 64, 64], [67, 0, 64, 64]]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("frame zip creates a readable archive signature", () => {
  const archive = framesToZip([{ name: "001-frame.png", data: new Uint8Array([137, 80, 78, 71]) }]);
  assert.deepEqual(Array.from(archive.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(Array.from(unzipSync(archive)["001-frame.png"]), [137, 80, 78, 71]);
});

test("GIF encoder returns a GIF89a animation with frame timing", async () => {
  const { encodeGif, renderAnimationFrames } = await import("./spriteSheet.ts");
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0]);
  const image = { naturalWidth: 2, naturalHeight: 2 } as HTMLImageElement;
  const context = { imageSmoothingEnabled: true, drawImage: () => undefined, getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D;
  const canvas = { width: 2, height: 2, getContext: () => context } as unknown as HTMLCanvasElement;
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => canvas } as unknown as Document;
  try {
    const frames = renderAnimationFrames([
      { id: "one", imageKey: "one", name: "one.png", offsetX: 0, offsetY: 0, pivotX: 1, pivotY: 1, durationMs: 100, image },
      { id: "two", imageKey: "two", name: "two.png", offsetX: 0, offsetY: 0, pivotX: 1, pivotY: 1, durationMs: 150, image },
    ], 2, 2);
    const data = encodeGif(frames, true);
    assert.equal(new TextDecoder().decode(data.slice(0, 6)), "GIF89a");
    assert.equal(data.at(-1), 0x3b);
  } finally { globalThis.document = previousDocument; }
});

test("APNG encoder emits a PNG animation with the expected frame count", async () => {
  const { encodeApng, renderAnimationFrames } = await import("./spriteSheet.ts");
  let index = 0;
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => {
    const frameIndex = index++;
    const rgba = new Uint8ClampedArray([255, 0, frameIndex ? 255 : 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const context = { imageSmoothingEnabled: true, drawImage: () => undefined, getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D;
    return { width: 2, height: 2, getContext: () => context } as unknown as HTMLCanvasElement;
  } } as unknown as Document;
  try {
    const frames = renderAnimationFrames([
      { id: "one", imageKey: "one", name: "one.png", offsetX: 0, offsetY: 0, pivotX: 1, pivotY: 1, durationMs: 100, image: { naturalWidth: 2, naturalHeight: 2 } as HTMLImageElement },
      { id: "two", imageKey: "two", name: "two.png", offsetX: 1, offsetY: 0, pivotX: 1, pivotY: 1, durationMs: 150, image: { naturalWidth: 2, naturalHeight: 2 } as HTMLImageElement },
    ], 2, 2);
    const encoded = encodeApng(frames, false);
    assert.deepEqual(Array.from(encoded.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    const animationChunk = new TextDecoder().decode(encoded).indexOf("acTL");
    assert.ok(animationChunk >= 0);
    const declaredFrameCount = new DataView(encoded.buffer, encoded.byteOffset + animationChunk + 4, 4).getUint32(0);
    assert.equal(declaredFrameCount, 2);
    const declaredPlayCount = new DataView(encoded.buffer, encoded.byteOffset + animationChunk + 8, 4).getUint32(0);
    assert.equal(declaredPlayCount, 1);
  } finally { globalThis.document = previousDocument; }
});

test("neutral atlas version contract accepts combined card and anchor metadata", async () => {
  const { neutralAtlasSchema } = await import("./schemas.ts");
  const parsed = neutralAtlasSchema.safeParse({
    schema: "sprite-studio-atlas/v1",
    meta: { app: "Sprite Studio", format: "RGBA8888", size: { width: 128, height: 64 }, scale: 1 },
    project: { id: "project", name: "Project" },
    sheet: { file: "project-combined.png", layout: "horizontal", padding: 2 },
    animations: [{ id: "card", name: "Walk", cardVersionId: "version", anchorVersionId: "anchor", fps: 8, loop: true, frameWidth: 64, frameHeight: 64, layout: "horizontal", padding: 2, frames: [{ filename: "frame.png", frame: { x: 0, y: 0, w: 64, h: 64 }, duration: 125, pivot: { x: 32, y: 58 } }] }],
  });
  assert.equal(parsed.success, true);
});
