import assert from "node:assert/strict";
import { test } from "node:test";
import { animationStripCrop } from "./animationSheet.ts";

test("animation sheet crop maps eight cells from landscape provider output as a 4-by-2 pose grid", () => {
  const crops = Array.from({ length: 8 }, (_, index) => animationStripCrop(1536, 1024, index));
  assert.deepEqual(crops[0], { x: 0, y: 64, width: 384, height: 384 });
  assert.deepEqual(crops[3], { x: 1152, y: 64, width: 384, height: 384 });
  assert.deepEqual(crops[4], { x: 0, y: 576, width: 384, height: 384 });
  assert.deepEqual(crops[7], { x: 1152, y: 576, width: 384, height: 384 });
});

test("animation sheet crop maps eight cells from a horizontal strip", () => {
  const crops = Array.from({ length: 8 }, (_, index) => animationStripCrop(2048, 256, index));
  assert.deepEqual(crops[0], { x: 0, y: 0, width: 256, height: 256 });
  assert.deepEqual(crops[7], { x: 1792, y: 0, width: 256, height: 256 });
});

test("animation sheet crop rejects invalid frame indices and dimensions", () => {
  assert.throws(() => animationStripCrop(10, 10, 8));
  assert.throws(() => animationStripCrop(3, 10, 0));
});
