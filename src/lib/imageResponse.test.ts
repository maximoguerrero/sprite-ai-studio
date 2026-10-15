import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectImageCandidates,
  decodeBase64Image,
  describeResponseShape,
  isHttpImageReference,
  revisedPromptFrom,
} from "./imageResponse.ts";

const pngBase64 = Buffer.from("imaginary-png-bytes-".repeat(8), "utf8").toString("base64");

test("collectImageCandidates reads the standard OpenAI generations shape", () => {
  const payload = { created: 1, data: [{ b64_json: pngBase64, revised_prompt: "cleaner sprite" }] };
  assert.deepEqual(collectImageCandidates(payload), [pngBase64]);
  assert.equal(revisedPromptFrom(payload), "cleaner sprite");
});

test("collectImageCandidates reads gateway shapes that are not data[0]", () => {
  assert.deepEqual(collectImageCandidates({ created: 1, images: [{ b64_json: pngBase64 }] }), [pngBase64]);
  assert.deepEqual(collectImageCandidates({ results: [{ image_base64: pngBase64 }] }), [pngBase64]);
  assert.deepEqual(collectImageCandidates({ output: [pngBase64] }), [pngBase64]);
  assert.deepEqual(collectImageCandidates({ b64_json: pngBase64 }), [pngBase64]);
});

test("collectImageCandidates reads nested image_url objects and inlined data URLs", () => {
  const dataUrl = `data:image/webp;base64,${pngBase64}`;
  const payload = { output: [{ type: "image", image_url: { url: dataUrl } }] };
  assert.deepEqual(collectImageCandidates(payload), [dataUrl]);
  const decoded = decodeBase64Image(dataUrl);
  assert.equal(decoded?.mime, "image/webp");
  assert.ok(decoded && decoded.bytes.length > 0);
});

test("collectImageCandidates keeps remote image URLs for the download path", () => {
  const payload = { data: [{ url: "https://cdn.example.com/frame.png" }] };
  const [candidate] = collectImageCandidates(payload);
  assert.ok(isHttpImageReference(candidate));
  assert.equal(decodeBase64Image(candidate), null);
});

test("decodeBase64Image ignores values that are not image data", () => {
  assert.equal(decodeBase64Image("/image.png"), null);
  assert.equal(decodeBase64Image("short"), null);
  assert.equal(decodeBase64Image("data:text/plain;base64,AAAA"), null);
});

test("a response without image data reports what it did contain", () => {
  const payload = { created: 1, status: "completed" };
  assert.deepEqual(collectImageCandidates(payload), []);
  assert.equal(describeResponseShape(payload), "keys: created, status");
});
