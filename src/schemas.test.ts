import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAnimationVersion, normalizeFrameTiming } from "./workspaceMigration.ts";
import { studioProjectSchema } from "./schemas.ts";

test("legacy zero frame duration is normalized to valid positive timing", () => {
  const frame = normalizeFrameTiming({ id: "frame-1", imageKey: "image-1", name: "frame.png", offsetX: 0, offsetY: 0, pivotX: 32, pivotY: 58, durationMs: 0 }, 8);
  assert.equal(frame.durationMs, 125);
  const project = { id: "project-1", name: "Project", slug: "project", folderPath: "projects/project", size: "64", anchorName: "Anchor", createdAt: "now", cards: [{ id: "card-1", name: "Walk", slug: "walk", folderPath: "projects/project/cards/animations/walk", kind: "animation", prompt: "walk", createdAt: "now", fps: 8, frames: [frame] }] };
  assert.equal(studioProjectSchema.safeParse(project).success, true);
});

test("legacy nonpositive version FPS and frame durations recover to safe defaults", () => {
  const version = normalizeAnimationVersion({ id: "version-1", number: 0, createdAt: "now", prompt: "run", phases: [], fps: 0, loop: true, frames: [{ id: "frame-2", imageKey: "image-2", name: "frame.png", offsetX: 0, offsetY: 0, pivotX: 32, pivotY: 58, durationMs: -20 }] }, 0, undefined);
  assert.equal(version.number, 1);
  assert.equal(version.fps, 8);
  assert.equal(version.frames[0].durationMs, 125);
  const project = { id: "project-2", name: "Project", slug: "project", folderPath: "projects/project", size: "64", anchorName: "Anchor", createdAt: "now", cards: [{ id: "card-2", name: "Run", slug: "run", folderPath: "projects/project/cards/animations/run", kind: "animation", prompt: "run", createdAt: "now", versions: [version] }] };
  assert.equal(studioProjectSchema.safeParse(project).success, true);
});
