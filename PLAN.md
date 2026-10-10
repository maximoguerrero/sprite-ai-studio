# Product Plan: Local-First Sprite & Asset Studio

## Product goal

Create a standalone, local-first application for generating game sprites, assets, and prompt-driven animations through user-configured OpenAI-compatible image endpoints. Projects organize one canonical anchor image, animation cards, still-asset cards, reusable generation skills, and exports. Generated files remain ordinary images and metadata that can be used without a proprietary runtime.

The product should be designed and implemented independently. Use broad game-art workflow needs as input, but do not copy another product's branding, interface, text, API shape, or implementation.

## Product structure

```text
Project
  Anchor image (uploaded or generated)
  Animation cards (Idle, Walk, Attack, Custom...)
  Asset cards (props, icons, objects...)
  Optional project-specific skills
  Combined exports
```

Each project has a folder. Each card has a folder within its project and owns its generations, versions, source frames, card-local sprite sheet, preview, and metadata. Combined project exports are generated from selected card sheets and do not alter card-level files.

## Image sizes

- Default new-project sprite canvas: **64×64**.
- Also offer **128×128** and **512×512** square presets.
- Support custom dimensions.
- New cards inherit the project default and can explicitly override it.
- Normalize provider output to the selected canvas while retaining transparency and the source image.
- Use nearest-neighbor scaling by default for pixel art; allow smooth scaling for non-pixel art.

## Anchor image

Every project begins by uploading an anchor or generating candidates from a prompt. The selected anchor establishes a canonical visual reference for related assets and animation cards. Keep anchor versions and their prompts. Cards record the exact anchor version used; changing the active anchor never silently changes existing card results.

Anchor metadata should include dimensions, art mode, direction, prompt/source, optional visual description, and default pivot/baseline.

## Animation cards

Each animation card describes one action, such as idle, walk, jump, attack, or a free-text motion. A card has its own prompt, optional prepared start pose, generation settings, immutable versions, frames, timing, placement edits, preview, sprite sheet, and atlas. Failed generation must preserve successful frames for retry.

The MVP animation strategy is frame-guided generation, which works with ordinary image endpoints. Split a motion prompt into editable phases/key poses and generate each against the canonical anchor and prepared pose when the endpoint supports image references. Native animation endpoints can be added through optional provider capabilities later.

Suggested defaults (editable): idle 4–8 frames and looping; walk/run 6–8 and looping; jump 6–10, attack 6–12, hurt 3–5, death 6–12 and non-looping. Users can provide a custom prompt, frame count, FPS, and loop behavior.

## Manual alignment editor

Provide direct manipulation in the card preview so users can recenter sprites and fix frame-to-frame movement jitter. Keep frame pixels immutable; store placement offsets separately.

- Fixed-size frame canvas with centerline, optional ground baseline, and editable pivot.
- Drag sprite to set X/Y offsets; arrow keys nudge by one pixel and Shift+arrow by ten.
- Onion skin adjacent frames.
- Center selected frame, match previous frame, apply placement to selected frames, and reset placement.
- Support canvas-center, grounded/baseline, custom-pivot, and manual alignment.
- Use the same placement transforms for animation preview, card sheet, GIF/WebP/APNG, and combined project export.

This editor-to-export parity is a core correctness requirement: a correction visible in preview must be present in every exported form.

## Still asset cards

Projects can generate individual assets in addition to animations: props, weapons, icons, environmental objects, and similar game art. Asset cards support text prompts, references, art mode, size preset, transparency preference, variations, versions, preview, and PNG export. Optionally pack selected still assets into a project sheet. Keep asset cards distinct from animation cards, which own a timed sequence and animation metadata.

## Reusable skills library

Users can save prompt recipes and generation settings as reusable, editable skills. A skill is structured data and workflow guidance, not executable code. Include name, description, category, prompt template, optional negative prompt, placeholders, applicable defaults (size, pixel-art mode, transparency, frames, FPS, loop), workflow notes, and schema version.

Support browse/search, edit, duplicate, apply, import/export as JSON or Markdown, and both global and project-specific libraries. Applying a skill pre-fills editable settings. Save a snapshot of the applied skill/settings with each generation so later skill edits do not alter history.

## Provider integration

Define an endpoint-neutral provider adapter. Start with a configurable OpenAI-compatible image generation API and add image-edit/reference support where the provider offers it. Detect or let the user configure capabilities rather than assuming every compatible endpoint supports identical features.

Provider profile fields: display name, base URL, model ID, API key reference, and optional request/response mapping. Test connection and capabilities explicitly. Store credentials in the operating-system credential store when available; never put API keys in project files, prompts, logs, generation snapshots, or exports.

```ts
interface ImageProvider {
  getCapabilities(): Promise<ProviderCapabilities>
  generateImage(request: ImageGenerationRequest): Promise<GenerationJob>
  poll(jobId: string): Promise<GenerationJobStatus>
}
```

Potential capabilities: text-to-image, image-to-image, multiple references, transparency, seed control, native animation, and max images per request. Keep provider HTTP details out of the domain model.

## Project filesystem

```text
app-data/
  skills/
projects/
  fox-ranger/
    project.json
    anchor/
      original.png
      versions/v001.png
      anchor.json
    cards/
      animations/walk/
        card.json
        source-pose/
        versions/v001/frames/000.png
        versions/v001/spritesheet.png
        versions/v001/preview.webp
        versions/v001/atlas.json
        current/
      assets/iron-sword/
        card.json
        versions/v001.png
    exports/
      individual/
      combined/
```

Treat project files as the durable source of truth and SQLite as a searchable app index/cache. Use safe normalized slugs while preserving display names in metadata. Never store secrets in project directories.

## Card and project exports

Every ready animation card automatically builds its own sprite sheet and atlas. Render each frame onto the card's fixed canvas using its crop, offset, pivot, and duration; pack frames using that card's selected layout. Build preview and exports from the same normalized frame representation.

The project exporter selects and orders cards, then stitches their card-local sheets into a combined sprite sheet (vertical card rows as the default; horizontal and grid layouts as options). It creates a combined atlas with animation name, card/version ID, anchor version, frame rectangles, frame durations, FPS, loop behavior, and pivot coordinates. It can optionally package individual card exports alongside the combined sheet and manifest.

Also export source PNG frames in a ZIP, GIF, animated WebP/APNG, JSON atlas, and standalone still PNGs. Preserve original generated images. Use engine presets (Godot, Unity, Phaser, GameMaker, PixiJS) after the neutral export contract is stable.

## Technical direction

- Desktop target: Tauri 2 with React, TypeScript, and Vite.
- Local metadata index: SQLite; durable project content in the filesystem.
- Secrets: OS credential store or Tauri Stronghold.
- Typed schemas and provider boundary validation (e.g. Zod).
- Local image processing for composition, nearest-neighbor scaling, transparent padding, preview rendering, sprite sheet packing, and exports.
- Persistent local generation job queue with explicit status, cancellation, retry, and recovery behavior.
- Core processing and export logic should be testable independently of the UI and desktop shell.

### Current foundation implementation notes

- Browser development stores workspace metadata and image blobs in IndexedDB; this is a browser fallback, not the final desktop filesystem source of truth.
- The Tauri 2 wrapper is scaffolded in `src-tauri/`; the desktop shell mirrors project/card metadata into a SQLite index through the Tauri SQL plugin.
- The browser workspace can export portable JSON backups and, where supported, write project/card/frame folders to a user-selected directory.
- Provider generation jobs are persisted in workspace metadata and recovered as retryable failures if the app closes during a request.
- Anchor assets are stored as immutable image versions; projects select one active anchor and cards retain the version they referenced.
- Rust/Cargo and native desktop libraries must be installed to compile and verify the Tauri shell on the target machine.

## Phased delivery

1. **Foundation:** project scaffold, project filesystem/metadata, project browser, 64×64 default and 128×128/512×512/custom size choices, anchor upload, settings model.
2. **Provider and anchor:** secure provider profiles, endpoint/capability testing, generated anchors, versioned canonical anchor.
3. **Cards and still assets:** animation card and still-asset card workflows, local versions, prompts, preview, and persistence.
4. **Prompt animation:** phase planner, reference-aware frame jobs, polling/retries, progress, and partial failure recovery.
5. **Alignment and card exports:** drag-to-recenter editor, pivot/baseline, onion skin, card sheets, atlas, GIF/WebP/APNG/ZIP.
6. **Project exports and skills:** combined sheets/atlas, card selection/order, reusable global and project skills, import/export and snapshots.
7. **Hardening and integrations:** project archive/recovery, migrations, offline editing/export, provider-specific adapters, engine presets, then directional animation and tilesets.

## MVP acceptance criteria

- Configure an OpenAI-compatible endpoint without source changes and keep credentials out of project data and logs.
- Create a project with a user-uploaded or generated anchor and default 64×64 canvas; select 128×128, 512×512, or custom sizes.
- Create an animation card and a still-asset card, each stored in its own project subfolder.
- Give an animation a natural-language motion prompt and generate an editable frame sequence using a reference anchor where supported.
- Drag a frame to recenter it; see identical placement in preview, card sheet, animation export, and combined export.
- Each animation card produces its own sheet and atlas; project export stitches selected card sheets and records animation/frame metadata.
- Save and reuse a skill, and preserve the skill snapshot used by a generation.
- Retry failed frames without discarding successful work; edit and export completed projects offline.
