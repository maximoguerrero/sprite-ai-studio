import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorClose,
  createBuffer,
  floodFill,
  getPixel,
  replaceColor,
  setPixel,
  stampCircle,
  strokeLine,
} from "./frameTouchup.ts";

const opaque = (r: number, g: number, b: number) => ({ r, g, b, a: 255 });
const clear = { r: 0, g: 0, b: 0, a: 0 };

test("createBuffer starts fully transparent", () => {
  const buf = createBuffer(2, 2);
  assert.equal(buf.data.length, 16);
  assert.deepEqual(getPixel(buf, 0, 0), clear);
});

test("setPixel/getPixel round-trips, clamps channels, and ignores out-of-range writes", () => {
  const buf = createBuffer(2, 2);
  setPixel(buf, 1, 1, { r: 300, g: -5, b: 128, a: 255 });
  assert.deepEqual(getPixel(buf, 1, 1), { r: 255, g: 0, b: 128, a: 255 });
  setPixel(buf, 5, 5, opaque(255, 0, 0)); // out of bounds, ignored
  assert.deepEqual(getPixel(buf, 5, 5), clear);
});

test("colorClose respects per-channel tolerance", () => {
  assert.ok(colorClose(opaque(10, 10, 10), opaque(12, 9, 10), 2));
  assert.ok(!colorClose(opaque(10, 10, 10), opaque(13, 9, 10), 2));
});

test("floodFill fills a contiguous region and stops at a boundary", () => {
  const buf = createBuffer(3, 1);
  setPixel(buf, 0, 0, opaque(0, 0, 0));
  setPixel(buf, 1, 0, opaque(0, 0, 0));
  setPixel(buf, 2, 0, opaque(255, 255, 255));
  const changed = floodFill(buf, 0, 0, opaque(255, 0, 0));
  assert.equal(changed, 2);
  assert.deepEqual(getPixel(buf, 0, 0), opaque(255, 0, 0));
  assert.deepEqual(getPixel(buf, 1, 0), opaque(255, 0, 0));
  assert.deepEqual(getPixel(buf, 2, 0), opaque(255, 255, 255));
});

test("floodFill with tolerance spans near colors but not far ones", () => {
  const buf = createBuffer(3, 1);
  setPixel(buf, 0, 0, opaque(100, 100, 100));
  setPixel(buf, 1, 0, opaque(103, 100, 100));
  setPixel(buf, 2, 0, opaque(200, 100, 100));
  const changed = floodFill(buf, 0, 0, opaque(0, 255, 0), { tolerance: 5 });
  assert.equal(changed, 2);
  assert.deepEqual(getPixel(buf, 2, 0), opaque(200, 100, 100));
});

test("floodFill contiguous=false replaces every match across the image", () => {
  const buf = createBuffer(3, 1);
  setPixel(buf, 0, 0, opaque(0, 0, 0));
  setPixel(buf, 1, 0, opaque(255, 255, 255));
  setPixel(buf, 2, 0, opaque(0, 0, 0));
  const changed = floodFill(buf, 0, 0, opaque(0, 0, 255), { contiguous: false });
  assert.equal(changed, 2);
  assert.deepEqual(getPixel(buf, 1, 0), opaque(255, 255, 255));
});

test("floodFill with the same color is a no-op", () => {
  const buf = createBuffer(2, 1);
  setPixel(buf, 0, 0, opaque(9, 9, 9));
  setPixel(buf, 1, 0, opaque(9, 9, 9));
  assert.equal(floodFill(buf, 0, 0, opaque(9, 9, 9)), 0);
});

test("replaceColor recolors the whole palette entry within tolerance", () => {
  const buf = createBuffer(4, 1);
  setPixel(buf, 0, 0, opaque(200, 30, 30));
  setPixel(buf, 1, 0, opaque(20, 200, 20));
  setPixel(buf, 2, 0, opaque(201, 31, 29));
  setPixel(buf, 3, 0, opaque(20, 20, 200));
  const changed = replaceColor(buf, opaque(200, 30, 30), opaque(0, 0, 0), 3);
  assert.equal(changed, 2);
  assert.deepEqual(getPixel(buf, 0, 0), opaque(0, 0, 0));
  assert.deepEqual(getPixel(buf, 2, 0), opaque(0, 0, 0));
  assert.deepEqual(getPixel(buf, 1, 0), opaque(20, 200, 20));
});

test("stampCircle paints a filled disc and leaves corners clear", () => {
  const buf = createBuffer(5, 5);
  const changed = stampCircle(buf, 2, 2, 1, { kind: "paint", color: opaque(255, 0, 0) });
  assert.equal(changed, 5); // center + 4 orthogonal
  assert.deepEqual(getPixel(buf, 2, 2), opaque(255, 0, 0));
  assert.deepEqual(getPixel(buf, 1, 2), opaque(255, 0, 0));
  assert.deepEqual(getPixel(buf, 1, 1), clear); // corner outside the disc
});

test("erase stroke sets alpha to zero", () => {
  const buf = createBuffer(3, 1);
  setPixel(buf, 1, 0, opaque(255, 0, 0));
  strokeLine(buf, 1, 0, 1, 0, 0, { kind: "erase" });
  assert.deepEqual(getPixel(buf, 1, 0), clear);
});

test("strokeLine rasterizes a diagonal without gaps", () => {
  const buf = createBuffer(4, 4);
  strokeLine(buf, 0, 0, 3, 3, 0, { kind: "paint", color: opaque(0, 0, 255) });
  for (let i = 0; i < 4; i++) assert.deepEqual(getPixel(buf, i, i), opaque(0, 0, 255));
});
