# Mockup workspace

OpenPencil mockups for the UI redesign. Plan: `plans/UI_REDESIGN_PLAN.md`.

This folder is the source of truth for what the redesigned UI should look like. Nothing in
`src/` gets restyled until the matching mockup page exists and is signed off.

## 1. Contents

```
plans/mockup/
  README.md              this file
  references/            19 curated screenshots of target software + INDEX.md (URLs)
  contact_sheet.png      all 19 in one image
  sources/               raw scrape candidates + manifest.json (provenance)
  diffs/                 before/after captures (created in Phase 1)
  sprite-studio.fig      the OpenPencil document (created in Phase 0)
```

### Review PNGs (approve these before any code changes)

Exported from `sprite-studio.fig` at 2x. The app itself is untouched until a sheet is signed off.

| File                  | What it is                                                        |
| --------------------- | ----------------------------------------------------------------- |
| `00-tokens.png`       | token sheet from `00 Tokens`                                      |
| `current-main-1440.png` | the **running app** at 1440x900, for reference (not a mockup)   |
| `main-v2-1440.png`    | main screen, 1440x900, sidebar expanded                          |
| `main-v2-1024.png`    | main screen, 1024x768, sidebar collapsed to a 56px icon rail      |
| `main-compare-1440.png` | current app stacked above the v2 mockup — the one to look at first |

Regenerate with `export_image` on the artboard node, passing `ids: [<node id>]` and a
`maxEdge` above the pixel size — omitting `ids` exports the whole page and the 1280 default
`maxEdge` downsamples it.

## 2. How OpenPencil is reached

OpenPencil 0.16.0 runs natively in WSL as a systemd user service; OpenCode connects over
local stdio, so there is no port, token, or firewall involved.

```bash
~/bin/openpencil-status                 # health check
systemctl --user restart openpencil-app # restart app + MCP server
```

The agent drives the canvas through the `open-pencil` skill (`~/.config/opencode/skills/open-pencil/`)
and the 132 `openpencil_*` tools. Design-authoring conventions live in
`references/design-authoring.md` inside that skill.

## 3. Document structure

One OpenPencil document, one page per mockup phase. Page names match the phase table in the plan.
The file is `plans/mockup/sprite-studio.fig`; open it with `openpencil documents open` or the
`open_file` tool. A `99 Scratch` page exists for throwaway work — never review from it.

| Page              | Contents                                                                  | Phase |
| ----------------- | ------------------------------------------------------------------------- | ----- |
| `00 Tokens`       | color ramps, type scale, spacing, radii, elevation, focus rings           | 0     |
| `01 Shell`        | topbar, left nav (expanded + icon rail), status bar, empty states         | 1     |
| `02 Workspace`    | project header, anchor panel, card grid, card tile states, create dialogs | 2     |
| `03 Frame Editor` | canvas, frame strip, timeline, inspector, touch-up mode                   | 3     |
| `04 Settings`     | settings nav, provider list/form, theme editor, custom theme round trip   | 4     |
| `05 Components`   | skills, still asset editor, dialogs, job panel, video spike panel         | 5     |

### Tokens live as variables, not painted rectangles

The document carries 64 variables in four collections, mirroring `src/tokens.css`:

| Collection   | Kind  | Contents                                                      |
| ------------ | ----- | ------------------------------------------------------------- |
| `Studio`     | COLOR | the 16 semantic tokens, resolved for the `studio` preset      |
| `Academic`   | COLOR | the same 16 names, resolved for the `academic` preset         |
| `State`      | COLOR | danger / success / warning with their backgrounds and borders |
| `Primitives` | FLOAT | spacing, radii, type scale, density, layout widths            |

Every swatch on `00 Tokens` is bound with `designVar()`, so changing a variable restyles the
sheet. Values were read out of the running app with `getComputedStyle`, not chosen by eye —
that is what makes the `color-mix()` derivations trustworthy in the mockup.

Because the two presets are separate collections rather than modes (the MCP server exposes no
mode API), switching a mockup to `academic` means rebinding to the `Academic/*` variables.

## 4. Conventions

- **Artboard sizes:** 1440×900 (primary), 1280×800, 1024×768 (the current 760px floor gets
  its own artboard only if the layout survives it).
- **Naming:** `<screen>/<region>/<state>` — e.g. `workspace/card-tile/selected`.
  Every top-level frame name must map to a real component file, so a mockup can be traced to code.
- **Colors come from the token page**, never picked by eye. If a color is not on `00 Tokens`,
  it does not exist.
- **Two themes per screen** from Phase 0 on: `studio` (neutral dark) and `academic` (navy dark).
  A screen is not done until both render.
- **Real content.** Mockups use real strings from the app ("Add animation", "Extract frames",
  "Touch up this frame"), not lorem ipsum. Placeholder text hides density problems.

## 5. Loop

1. Build the page in OpenPencil.
2. Export a PNG into this folder for review (`openpencil_export`).
3. Review against `references/` — is the density, type scale, and chrome actually matching?
4. Sign off, then implement in code behind `data-ui="v2"`.
5. Capture before/after into `diffs/`, check the §6 checklist, commit mockup + code together.

## 6. Parity checklist

Every control below must exist in the redesigned screen. Checked per phase before code lands.
This list is the contract against regressions; extend it when a component is added.

### Shell — `Topbar.tsx`, `Sidebar.tsx`, `App.tsx`

- [ ] view tabs: Workspace / Skills / Settings
- [ ] project switcher + project create (`CreateProjectDialog`)
- [ ] provider status indicator, theme toggle (`ThemeSettings`)
- [ ] nav collapse to icon rail; all three views still reachable

### Workspace — `Workspace.tsx`, `CardTile.tsx`, `AnchorPanel.tsx`, `CreateCardDialog.tsx`

- [ ] Add animation / Add asset
- [ ] card actions: Rename, Duplicate, Delete, Move up, Move down, Archive, Hide archived
- [ ] archived sections: Archived animations / Archived assets
- [ ] anchor: upload, `Generate anchor`, pivot X/Y
- [ ] `CreateCardDialog`: canvas size (`CanvasSizeFields`), art mode (`ArtModePicker`), view direction (`ViewDirectionPicker`)

### Frame editor — `FrameEditor.tsx`, `FrameTouchUpEditor.tsx`

- [ ] frame strip: add, remove, reorder, rename card
- [ ] frame placement: nudge up/down/left/right, frame scale, pivot edit + "click or drag to move pivot"
- [ ] zoom in / zoom out
- [ ] set as card thumbnail, remove card thumbnail
- [ ] extract frames, frames ZIP export
- [ ] touch-up: local pixel editor and AI image-edit, plus revert to original
- [ ] preview + sprite sheet
- [ ] keyboard: arrows, Enter

### Still assets — `StillAssetEditor.tsx`

- [ ] generate asset, generate variations
- [ ] layers: add, delete, show/hide from preview, layer count
- [ ] asset scale, card reference, project anchor, solid/transparent, pixel art
- [ ] rewrite with text model

### Generation — `GenerationConfirmDialog.tsx`, `GenerationJobPanel.tsx`, `ImageModelPicker.tsx`, `PhasePlannerForm.tsx`

- [ ] model picker with requirement filtering
- [ ] confirm dialog before any paid generation
- [ ] job queue: status, cancel, retry
- [ ] phase planner form

### Skills — `SkillsPage.tsx`, `SkillForm.tsx`

- [ ] list, create, edit, delete, apply to card

### Settings — `SettingsPage.tsx`, `ProviderSettingsPanel.tsx`, `ThemeSettings.tsx`

- [ ] provider profiles: add, edit, delete, test
- [ ] theme presets `studio` / `academic`
- [ ] custom themes: create, edit 7 colors, delete, persist across reload
- [ ] **round trip:** a theme created in the old UI renders correctly in v2

### Export — `ProjectExportDialog.tsx`, `animationSheet.ts`

- [ ] export options unchanged; output bytes identical to v1

## 7. Diff harness

`diff.sh` (written in Phase 1) drives Playwright against the dev server and writes
`diffs/<screen>-<viewport>-{v1,v2}.png`. Same build, only `data-ui` differs, so any visual
change is reviewable as an image pair rather than a CSS diff.
