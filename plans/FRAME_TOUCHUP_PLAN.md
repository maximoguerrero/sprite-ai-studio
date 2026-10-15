# Frame Touch-Up — Plan

Add a per-frame image-edit capability so each animation frame can be cleaned up without regenerating it. Two ways to produce a touch-up: a local pixel editor (brush/erase/fill/color-replace, no cost, deterministic) and an AI image-edit job (reuse the existing image-to-image provider path). Both are in scope. Both write an **edited copy** of the frame; the original generated image stays immutable and can be reverted to at any time.

This follows the product rule in `PLAN.md` ("keep frame pixels immutable; store placement separately"): placement (offset/scale/pivot) is untouched, and a touch-up is a new image, not a mutation of the source blob.

## Data model

- Add optional `editImageKey?: string` to `StudioFrame` (`src/types.ts`) and `frameSchema` (`src/schemas.ts`). Optional field → no migration; existing workspaces load unchanged.
- Single source of truth for "which image a frame shows": add `activeFrameImageKey(frame) = frame.editImageKey ?? frame.imageKey` in `src/types.ts` (or `src/lib/imageUtils.ts`). Every place that loads/exports a frame image switches to this helper so preview and export stay in parity (the core correctness rule in `PLAN.md`).
- Revert = clear `editImageKey` and delete the edit blob. Duplicate card resets `editImageKey` (mirrors the existing `thumbnailFrameId` reset in `useCardActions.duplicateCard`).

## Rendering / export parity (single change point)

- `FrameEditor` preview: the frame-image load effect (`frameImageKeys`) and `activeImageUrl` must key off `activeFrameImageKey`, so the canvas shows the edited pixels.
- `FrameEditor.loadExportFrames()` loads `activeFrameImageKey` instead of `frame.imageKey`; `renderFrame`/`renderSheet`/`renderAnimationFrames`/GIF/WebP/APNG/ZIP/Export-selected-PNG then use the edited image with **no changes** in `src/spriteSheet.ts` (they receive the already-resolved `frame.image`).
- Desktop export (`src/productFoundation.ts:103`) writes `imageBlobs[activeFrameImageKey(frame)]`.

## Local pixel editor (primary)

New `src/components/FrameTouchUpEditor.tsx` opened from FrameEditor as a `Dialog` (reuse `src/components/Dialog.tsx`), one frame at a time:

- Canvas at the frame's native pixel size, nearest-neighbor zoom (reuse the zoom/pixelate patterns already in FrameEditor), checkerboard background, optional onion-skin of the previous frame for consistency.
- Tools: brush (color + size), eraser (alpha→0), eyedropper, flood fill, and "replace color" (recolor a picked palette entry — the common pixel-art touch-up). Green-screen cleanup reuses `removeGreenScreen` from `src/lib/imageUtils.ts`.
- Undo/redo stack (snapshot per stroke), Save / Cancel.
- Save: `canvas.toBlob` PNG → `saveImage("frame-edit-<frameId>-<n>", blob)` → set `frame.editImageKey`. Original `imageKey` blob is never overwritten.
- Pure canvas math (fill bounds, color-replace, stroke rasterization) lives in a new `src/lib/frameTouchup.ts` so it is unit-testable without the UI (matches the "testable independent of UI" rule in `PLAN.md`).

Entry points in FrameEditor: a "✎ Touch up" button on each timeline thumbnail (next to the existing ★ thumbnail button) and a "Touch up selected frame" button in the SELECTED FRAME panel (grouped with Export in `.frame-action-row`).

## AI image-edit touch-up

Both options are committed scope. They share one output contract (`editImageKey`), so they compose on the same frame: AI-touch-up first to fix broad issues, then manual pixel passes to clean edges — or the reverse. Each save replaces the current edited copy; the original `imageKey` is never overwritten, so revert always returns to the generated source.

- Add `"frame-edit"` to the `GenerationJob.target` union (`src/types.ts`) and `generationJobSchema` (`src/schemas.ts`).
- `useGenerationActions`: new `touchUpFrameWithAI(card, frame, prompt)` mirroring `editAnchorImage` — reference = `activeFrameImageKey(frame)`, prompt = touch-up instruction (fix artifacts, clean edges, keep identity/palette/pose, transparent background). Confirm dialog with cost note.
- `useGenerationJobs`: on success, attach `outputImageKey` as the frame's `editImageKey` (original preserved). Reuses the existing image-to-image request path and `normalizeGeneratedImage`.
- Gate on `capabilities.imageToImage` like `generateInBetweenFrame`.

## References, GC, import/recovery

- `src/lib/imageReferences.ts`: include `editImageKey` in referenced keys so edits are not GC'd.
- `useCardActions` delete paths: delete `editImageKey` blobs with the frame/card; clear on revert.
- `useProjectActions` import/recover: remap and validate `editImageKey` alongside `imageKey` (same `missing:` handling).

## Phases & estimate (~7–11 dev-days, both options)

| Phase                    | Scope                                                                                                                                                                | Estimate   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1 — Model + parity       | `editImageKey` field + schema; `activeFrameImageKey` helper; wire preview, `loadExportFrames`, and desktop export to it; revert + duplicate reset                    | 1–1.5 days |
| 2 — Local editor UI      | `FrameTouchUpEditor` dialog: canvas, zoom, brush/erase/eyedropper/fill/replace-color, undo/redo, save→`editImageKey`; entry buttons in timeline + selected-frame row | 2–3 days   |
| 3 — Editor logic lib     | `src/lib/frameTouchup.ts` pure ops (fill, color-replace, stroke) + unit tests                                                                                        | 1 day      |
| 4 — References/GC/import | `imageReferences`, delete paths, project import/recovery remap                                                                                                       | 1 day      |
| 5 — AI touch-up          | `frame-edit` job target, `touchUpFrameWithAI`, attach as `editImageKey`                                                                                              | 1–2 days   |

Biggest risk: keeping preview/export parity — mitigated by routing every frame-image load through `activeFrameImageKey`.

## Checklist

### Phase 1 — Model + parity

- [x] `editImageKey?: string` on `StudioFrame` + `frameSchema`
- [x] `activeFrameImageKey(frame)` helper
- [x] FrameEditor preview loads/keys the edited image
- [x] `loadExportFrames` uses `activeFrameImageKey` (sheet/GIF/WebP/APNG/ZIP/selected PNG all follow)
- [x] `productFoundation` desktop export writes the edited blob
- [x] Revert clears `editImageKey` + deletes edit blob; duplicate resets it

### Phase 2 — Local editor UI

- [x] `FrameTouchUpEditor` dialog with native-size nearest-neighbor canvas + zoom
- [x] Brush, eraser, eyedropper, flood fill, replace-color
- [x] Undo/redo; Save writes `frame-edit-*` blob and sets `editImageKey`
- [x] "Touch up" button on timeline thumbs + selected-frame action row
- [x] Semi-transparent brush-size ring that tracks the pointer; native cursor hidden while painting

### Phase 3 — Editor logic lib

- [x] `src/lib/frameTouchup.ts` pure canvas operations
- [x] Unit tests for fill bounds, color-replace, stroke rasterization

### Phase 4 — References / GC / import

- [x] `imageReferences` counts `editImageKey`
- [x] Frame/card delete removes edit blobs
- [x] Project import/recover remaps + validates `editImageKey`

### Phase 5 — AI touch-up

- [x] `frame-edit` target in types + schema
- [x] `touchUpFrameWithAI` (reference = current frame, gated on imageToImage)
- [x] Success attaches `editImageKey`, original preserved

### Phase 6 — Per-job model choice (follow-up)

Pick the provider/model for each AI touch-up from the list of image-edit-capable models across configured providers, instead of being locked to the global Topbar selection.

- [x] `imageModel?: string` on `GenerationJob` + `generationJobSchema` (per-job override, no migration)
- [x] `useImageModelCatalog` groups carry an `imageToImage` capability flag
- [x] `runGeneration` applies the override via a shallow-cloned profile, leaving the profile + global selection untouched
- [x] `touchUpFrameWithAI(card, frame, instruction, override?)` resolves provider + model from the choice
- [x] AI touch-up dialog model picker lists only edit-capable providers; submit gated on a valid choice
