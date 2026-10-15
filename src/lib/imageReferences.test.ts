import assert from "node:assert/strict";
import { test } from "node:test";
import type { StudioProject } from "../types.ts";
import { referencedImageKeys, unreferencedImageKeys } from "./imageReferences.ts";

// Only the fields referencedImageKeys reads are populated; the cast keeps the fixture short.
const projects = [
  {
    id: "project-1",
    cards: [
      {
        id: "card-1",
        frames: [
          { id: "frame-1", imageKey: "image-1" },
          { id: "frame-2", imageKey: "image-2", editImageKey: "edit-2" },
        ],
        versions: [
          { id: "version-1", frames: [{ id: "frame-3", imageKey: "image-3", editImageKey: "edit-3" }] },
          { id: "version-2", frames: [{ id: "frame-4", imageKey: "image-4" }] },
        ],
      },
    ],
  },
] as unknown as StudioProject[];

test("referencedImageKeys counts frame edit copies", () => {
  const keys = referencedImageKeys(projects);
  assert.ok(keys.has("image-2"));
  assert.ok(keys.has("edit-2"));
  assert.ok(keys.has("edit-3"));
});

test("frame edit copies are kept by the garbage collector", () => {
  const stored = ["image-1", "edit-2", "edit-3", "edit-orphan"];
  assert.deepEqual(unreferencedImageKeys(projects, stored), ["edit-orphan"]);
});

test("exceptCardId drops that card's edits so its delete can clean them up", () => {
  const keys = referencedImageKeys(projects, "card-1");
  assert.ok(!keys.has("edit-2"));
  assert.ok(!keys.has("edit-3"));
});
