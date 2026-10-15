import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAnimationVersion, normalizeFrameTiming } from "./workspaceMigration.ts";
import { frameSchema, generationJobSchema, studioProjectSchema } from "./schemas.ts";
import { activeFrameImageKey } from "./types.ts";

test("legacy zero frame duration is normalized to valid positive timing", () => {
  const frame = normalizeFrameTiming(
    {
      id: "frame-1",
      imageKey: "image-1",
      name: "frame.png",
      offsetX: 0,
      offsetY: 0,
      pivotX: 32,
      pivotY: 58,
      durationMs: 0,
    },
    8
  );
  assert.equal(frame.durationMs, 125);
  assert.equal(frame.scale, 1);
  const project = {
    id: "project-1",
    name: "Project",
    slug: "project",
    folderPath: "projects/project",
    size: "64",
    anchorName: "Anchor",
    createdAt: "now",
    cards: [
      {
        id: "card-1",
        name: "Walk",
        slug: "walk",
        folderPath: "projects/project/cards/animations/walk",
        kind: "animation",
        prompt: "walk",
        createdAt: "now",
        fps: 8,
        frames: [frame],
      },
    ],
  };
  assert.equal(studioProjectSchema.safeParse(project).success, true);
});

test("legacy nonpositive version FPS and frame durations recover to safe defaults", () => {
  const version = normalizeAnimationVersion(
    {
      id: "version-1",
      number: 0,
      createdAt: "now",
      prompt: "run",
      phases: [],
      fps: 0,
      loop: true,
      frames: [
        {
          id: "frame-2",
          imageKey: "image-2",
          name: "frame.png",
          offsetX: 0,
          offsetY: 0,
          pivotX: 32,
          pivotY: 58,
          durationMs: -20,
        },
      ],
    },
    0,
    undefined
  );
  assert.equal(version.number, 1);
  assert.equal(version.fps, 8);
  assert.equal(version.frames[0].durationMs, 125);
  assert.equal(version.frames[0].scale, 1);
  const project = {
    id: "project-2",
    name: "Project",
    slug: "project",
    folderPath: "projects/project",
    size: "64",
    anchorName: "Anchor",
    createdAt: "now",
    cards: [
      {
        id: "card-2",
        name: "Run",
        slug: "run",
        folderPath: "projects/project/cards/animations/run",
        kind: "animation",
        prompt: "run",
        createdAt: "now",
        versions: [version],
      },
    ],
  };
  assert.equal(studioProjectSchema.safeParse(project).success, true);
});

test("frame schema accepts frames with and without an editImageKey", () => {
  const base = {
    id: "frame-1",
    imageKey: "image-1",
    name: "frame.png",
    offsetX: 0,
    offsetY: 0,
    pivotX: 32,
    pivotY: 58,
    durationMs: 125,
  };
  assert.equal(frameSchema.safeParse(base).success, true);
  assert.equal(frameSchema.safeParse({ ...base, editImageKey: "frame-edit-frame-1-1" }).success, true);
  assert.equal(frameSchema.safeParse({ ...base, editImageKey: "" }).success, false);
});

test("normalizeFrameTiming preserves editImageKey", () => {
  const frame = normalizeFrameTiming(
    { id: "frame-1", imageKey: "image-1", editImageKey: "frame-edit-frame-1-1", durationMs: 0 },
    8
  );
  assert.equal(frame.editImageKey, "frame-edit-frame-1-1");
});

test("activeFrameImageKey prefers the edited copy and falls back to the generated source", () => {
  assert.equal(activeFrameImageKey({ imageKey: "image-1" }), "image-1");
  assert.equal(activeFrameImageKey({ imageKey: "image-1", editImageKey: "frame-edit-1" }), "frame-edit-1");
});

test("generation job schema accepts frame-edit and video-animation targets", () => {
  const base = {
    id: "job-1",
    projectId: "project-1",
    providerProfileId: "provider-1",
    status: "queued",
    progress: 0,
    createdAt: "now",
    updatedAt: "now",
    request: {
      prompt: "clean up this frame",
      width: 64,
      height: 64,
      referenceAssetIds: [],
      transparentBackground: true,
      pixelArt: true,
    },
  };
  const frameEdit = generationJobSchema.safeParse({
    ...base,
    target: "frame-edit",
    request: { ...base.request, referenceImageKeys: ["frame-edit-1"], frameEdit: { frameId: "frame-1" } },
  });
  assert.equal(frameEdit.success, true);
  assert.equal(frameEdit.success && frameEdit.data.request.frameEdit?.frameId, "frame-1");
  assert.equal(generationJobSchema.safeParse({ ...base, target: "video-animation" }).success, true);
  assert.equal(generationJobSchema.safeParse({ ...base, target: "unknown-target" }).success, false);
});
