# Implementation Checklist

## Product foundation

- [x] Scaffold desktop-ready React/TypeScript frontend.
- [x] Scaffold Tauri 2 shell and SQL/filesystem/dialog plugin integrations. `npx tauri info` confirms Rust/Cargo, WebKitGTK, and librsvg are missing here, so the native build remains unverified.
- [x] Define shared project, anchor, card, frame, generation, skill, and export schemas with runtime validation.
- [x] Add workspace/skill schema versions and migrate legacy localStorage data into IndexedDB.
- [x] Define project root metadata and safe project/card slug rules.
- [x] Add automatic desktop project-folder persistence, SQLite metadata index, and manual project-folder export (browser folder writing uses File System Access API where supported).
- [x] Add project creation, open, rename, archive, and restore-from-JSON-backup flows.
- [x] Set new-project default sprite canvas to 64×64.
- [x] Offer 128×128, 512×512, and custom size options.
- [x] Make card size inherit project default, with a per-card override.

## Anchor image

- [x] Support uploading an anchor image.
- [x] Support generating new anchor versions from a prompt.
- [x] Select a canonical anchor version for the project.
- [x] Save anchor image and prompt/source metadata, art mode, direction, and pivot.
- [x] Keep previous anchor versions available.
- [x] Ensure anchor changes do not silently mutate existing cards.
- [x] Use the selected anchor as the default reference for new cards where supported.

## OpenAI-compatible provider

- [x] Add provider profile UI: name, base URL, model, and endpoint settings.
- [x] Store desktop API keys in OS credential storage; browser-only preview keeps keys in session memory.
- [x] Implement provider-neutral capability and request contracts.
- [x] Implement initial OpenAI-compatible text-to-image adapter for `/v1/images/generations`.
- [x] Add Parley image-generation profile preset using documented model IDs, image sizes, quality, bearer auth, and `b64_json` response.
- [x] Add xAI Grok Imagine profile preset using `grok-imagine-image-2.0` and documented image generations route.
- [x] Add image-edit/reference support for configured OpenAI-compatible endpoints and Grok; Parley remains text-to-image until its API documents edits. Native OpenAI-compatible image-edit uploads are supported; native Grok edit URL ingestion is still pending.
- [x] Add connection test via `/v1/models` and display returned models.
- [x] Add persistent generation jobs with status, retry, restart recovery, and error states; cancellation aborts browser requests and marks queued requests cancelled (native requests may finish after cancel).
- [x] Keep API keys out of provider profiles, workspace snapshots, and exports; route desktop provider requests through the native command bridge.
- [x] Wire explicit image generation to project anchors and still-asset cards, then normalize results to the target canvas.

## Animation cards

- [x] Create animation cards.
- [x] Rename, duplicate, reorder, archive, restore, and delete animation cards.
- [x] Store each card in its own project folder.
- [x] Add built-in action types and free-text custom animation prompts.
- [x] Add built-in action presets and initial frame-count, FPS, loop, and canvas settings; edit FPS/loop in the card editor.
- [x] Support prepared start-pose uploads tied to an anchor version.
- [x] Split prompts into editable animation phases/key poses.
- [x] Generate frames sequentially and retain successful results after a later frame fails; retry missing phases into a new version.
- [x] Keep immutable animation versions with prompt, phase, frame, timing, canvas, and anchor snapshots.

## Manual frame alignment

- [x] Render frame on a fixed card canvas with centerline and ground guide.
- [x] Drag sprite in preview to adjust per-frame X/Y placement.
- [x] Add one-pixel arrow-button nudging and keyboard nudging (Shift+arrow moves ten pixels).
- [x] Add pivot editing and onion-skin overlays.
- [x] Add reset placement control.
- [x] Add center, match-previous, and apply-to-selected controls.
- [x] Support canvas-center, grounded, custom-pivot, and manual alignment modes.
- [x] Store placement independently from imported frame pixels.
- [x] Verify preview, card sheet, animation exports, and combined exports use identical transforms.

## Still asset cards

- [x] Create and manage still-asset cards for props, icons, weapons, and objects.
- [x] Store each asset card in its own project folder.
- [x] Support prompt, reference image, size, art mode, transparency, and variations.
- [x] Keep versions and generated originals.
- [x] Add local crop, placement, preview, and PNG export.
- [x] Optionally pack selected still assets into an asset sheet.

## Card sheets and exports

- [x] Build a card-local sprite sheet from imported frames on export.
- [x] Generate card-local atlas metadata with frame rectangles, durations, FPS, loop, and pivot.
- [x] Support horizontal and grid frame layouts with configurable padding.
- [x] Export normalized individual PNG frames in a ZIP.
- [x] Export GIF, animated WebP, and APNG.
- [x] Preserve original imported frames; use nearest-neighbor scaling in editor and sheet rendering.
- [x] Add export tests that compare normalized frames and placement with preview output.

## Combined project exports

- [x] Select and order animation cards for a project export.
- [x] Stitch selected animation card frames into a combined sheet (vertical cards by default).
- [x] Support horizontal and grid combined layouts and configurable spacing.
- [x] Generate atlas entries for each animation and frame in combined coordinates.
- [x] Record card version and anchor version used in combined metadata.
- [x] Optionally include individual card exports in the project ZIP.
- [x] Ensure combined generation never overwrites card-local exports (download-only project export).

## Reusable skills

- [x] Define versioned, structured skill format (prompt template, defaults, workflow notes).
- [x] Add global skill library and optional project-specific skills.
- [x] Browse, search, edit, duplicate, and delete skills.
- [x] Save current card prompt and animation settings as a skill.
- [x] Apply skills as editable defaults to asset and animation cards.
- [x] Support placeholders such as `{subject}`, `{style}`, and `{motion}`.
- [x] Import/export skills as JSON or Markdown.
- [x] Snapshot applied skill contents/settings in generation history.
- [x] Do not execute arbitrary code from skills (skills are structured prompt/settings data only).

## UX, quality, and hardening

- [x] Show checkerboard, solid, and transparent preview backgrounds.
- [x] Add native-size and nearest-neighbor zoom inspection.
- [x] Add loop/seam preview and frame-difference inspection.
- [x] Support offline card editing and exports after generation (frame and asset data remain in local image storage).
- [x] Add project archive/import and missing-file recovery.
- [x] Add database migrations and crash/restart job recovery.
- [x] Add keyboard accessibility and clear loading/error/empty states for project and frame workflows.
- [x] Support pasting image frames from the system clipboard in the frame editor.
- [x] Add neutral atlas schema before engine-specific export presets.
- [x] Verify complete flow: project → anchor → animation/asset cards → recenter → card sheets → combined export.
