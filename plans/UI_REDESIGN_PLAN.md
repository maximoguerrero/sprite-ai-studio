# UI Redesign Plan — Professional Shell

Restyle Sprite Studio so it reads as professional creative software, without changing what
it does. Mockups are built first in OpenPencil; code follows the approved mockups.

Direction chosen: **professional creative tool, neutral dark** (Pixelmator Pro, Rive, Linear,
VS Code). Scope chosen: **design system + shell + 3 key screens first**.

Reference set and the URLs it came from: `plans/mockup/references/INDEX.md`.
Mockup workspace and OpenPencil workflow: `plans/mockup/README.md`.

## Why the current UI reads as amateur

Measured from `src/styles.css` (6,174 lines), not opinion:

| Problem                                   | Evidence                                                                                    | Target                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Type is too small to read as pro software | 164 of 195 `font-size` declarations are 7–11px (62 at 9px, 53 at 10px, 27 at 8px, 3 at 7px) | 13px body, 12px minimum for any label, 15/18/22 for headings |
| No elevation or depth system              | every surface is flat `--panel` with a 1px `--line` border                                  | 4 elevation levels: canvas, panel, raised, overlay           |
| Color is ad hoc                           | 299 distinct hex literals in one stylesheet                                                 | tokens only; no hex outside the token block                  |
| Theming multiplies work                   | 180 `data-theme` selectors, most re-listing the same 12 components                          | theme sets tokens once; components never mention a theme     |
| Accent does too much                      | 80 selectors reference `var(--lime)`                                                        | accent marks state only; chrome is neutral                   |
| Canvas is boxed in                        | fixed 244px sidebar + 61px topbar, panels always docked                                     | canvas dominant; panels collapsible/floatable                |

The palette itself (olive `#10100f` + lime `#c9f36a`) is not the problem — the lime is a fine
accent. The problem is that chrome, text, and art all compete at the same low contrast.

## Non-negotiables (the no-regression contract)

1. **Behavior is frozen.** No change to `src/types.ts` or `src/schemas.ts` semantics, storage
   keys (`sprite-studio.theme.v1`, `sprite-studio.customThemes.v1`, project folders), or export
   output. This plan touches markup and CSS only.
2. **The 7-key theme contract survives.** `ThemeSettings` exposes `background, panel, raised,
accent, text, muted, border` and `useThemePreferences` maps them onto 9 CSS variables
   (`--bg --panel --panel-2 --lime --lime-dim --text --line --soft --muted`). Any new semantic
   token must **derive** from those 7 keys, so a theme a user saved months ago still renders.
   This is the single largest regression risk in the plan.
3. **Every control stays reachable.** The parity checklist in `plans/mockup/README.md` §6 is
   signed off per screen before that screen's code changes.
4. **Keyboard shortcuts unchanged.**
5. **Minimum window width** stays 760px unless the mockups prove a new floor.

## Design system

Two token tiers. Primitives are fixed; semantic tokens are what components consume and what
themes override.

```
primitive:  space 4 8 12 16 24 32 | radius 4 6 10 | type 12 13 15 18 22 | elevation 0-3
semantic:   --canvas --surface --surface-raised --surface-overlay
            --text-primary --text-secondary --text-disabled
            --border --border-strong
            --accent --accent-soft --accent-text
            --state-success --state-warning --state-danger
```

Mapping that keeps custom themes working:

| Custom theme key | Feeds                                                                                |
| ---------------- | ------------------------------------------------------------------------------------ |
| `background`     | `--canvas`                                                                           |
| `panel`          | `--surface`                                                                          |
| `raised`         | `--surface-raised`, `--surface-overlay` (derived, +4% lightness)                     |
| `accent`         | `--accent`, `--accent-soft` (derived, 16% alpha), `--accent-text` (derived contrast) |
| `text`           | `--text-primary`; also seeds `--text-secondary`, which is mixed toward `--muted`     |
| `muted`          | `--text-tertiary`, and the low end of `--text-secondary` and `--text-disabled`       |
| `border`         | `--border`, `--border-strong` (derived)                                              |

Derived values are computed in CSS with `color-mix()`, so a 7-color custom theme still produces
a full system. **Verified in Phase 0:** the Linux WebView is WebKitGTK 2.50.4 (`color-mix()`
needs ≥ 2.40) and Windows ships WebView2 (needs Chrome ≥ 111). A precomputed fallback for the
`studio` preset sits in a `@supports not (color-mix)` block at the bottom of `src/tokens.css`.

## Layout target

```
┌──────────────────────────────────────────────────────────────┐
│ topbar  48px   project switcher · view tabs · status · actions│
├────┬────────────────────────────────────────────┬────────────┤
│nav │                                            │ inspector  │
│56/ │                canvas (dominant)           │ 300px      │
│240 │                                            │ collapsible│
├────┴────────────────────────────────────────────┴────────────┤
│ bottom dock 132px   frame strip · timeline   (workspace only)│
└──────────────────────────────────────────────────────────────┘
```

Left nav collapses to a 56px icon rail. Inspector collapses to zero. Canvas is never boxed in.

## Phases

Each phase is: mockup → review → implement → visual diff → commit. Never mockup two phases
ahead of implementation.

| #   | Deliverable                          | Mockup page       | Code touched                                                               | Done when                                             | Status      |
| --- | ------------------------------------ | ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ----------- |
| 0   | Token system + type scale            | `00 Tokens`       | new `src/tokens.css`; `styles.css` `:root` replaced                        | both presets + a custom theme render correctly        | **done**    |
| 1   | Shell: topbar + nav + status bar     | `01 Shell`        | `Topbar.tsx`, `Sidebar.tsx`, `App.tsx` layout                              | all 3 views reachable, nav collapses                  | not started |
| 2   | Workspace (project + cards + anchor) | `02 Workspace`    | `Workspace.tsx`, `CardTile.tsx`, `AnchorPanel.tsx`, `CreateCardDialog.tsx` | parity checklist signed                               | not started |
| 3   | Frame editor (hardest screen)        | `03 Frame Editor` | `FrameEditor.tsx`, `FrameTouchUpEditor.tsx`                                | parity checklist signed                               | not started |
| 4   | Settings + providers + theme editor  | `04 Settings`     | `SettingsPage.tsx`, `ProviderSettingsPanel.tsx`, `ThemeSettings.tsx`       | custom theme round-trip works                         | not started |
| 5   | Remaining surfaces                   | `05 Components`   | `SkillsPage.tsx`, `StillAssetEditor.tsx`, dialogs, `VideoSpikePanel.tsx`   | parity checklist signed                               | not started |
| 6   | CSS consolidation                    | —                 | delete per-theme component blocks, remove dead rules                       | `styles.css` under ~3,000 lines, 0 hex outside tokens | not started |

### Phase 0 — done

Built:

- `src/tokens.css` — primitives (space, radii, type, density, elevation), theme-independent
  state colors, the two presets' 7 keys, and the semantic layer under `:root[data-ui="v2"]`.
  It is now the only place a literal color is declared; the preset blocks were deleted from
  `styles.css` (6,174 → 6,145 lines).
- `src/uiVersion.ts` — sets `html[data-ui]` before first paint. `?ui=v1` or
  `localStorage["sprite-studio.ui"] = "v1"` switches back without a rebuild.
- `plans/mockup/sprite-studio.fig` — 7 pages (`00 Tokens` … `05 Components`, plus `99 Scratch`)
  and 64 variables in collections `Studio`, `Academic`, `State`, `Primitives`, holding the
  values the running app actually computes.

Verified, not assumed:

- `color-mix()` resolves in the shipped WebView (WebKitGTK 2.50.4).
- All three theme paths produce four **distinct** text tiers: `studio`, `academic`, and a
  seeded custom theme.
- Phase 0 is visually inert: v1 and v2 screenshots are pixel-identical (0 changed pixels at
  1440×900) in both presets. Nothing consumes the semantic layer yet, by design.
- `tsc -b` clean, `vite build` clean, 42/42 export tests pass.

Found and fixed while verifying: `useThemePreferences()` sets `--soft = colors.text` for custom
themes (the 7-key model has no "soft" key), so aliasing `--text-secondary` to `--soft` collapsed
primary and secondary into one color. `--text-secondary` now mixes `--soft` toward `--muted`,
which keeps a readable step in every theme without touching the stored schema.

Phase 3 is the risk gate: `FrameEditor.tsx` is 1,863 lines. Markup and class names change;
state, handlers, and effects do not. If the mockup cannot express the frame editor without
dropping a control, the mockup changes — not the control.

## Rollout mechanism

Restyle behind `html[data-ui="v2"]` so old and new CSS coexist during Phases 0–6:

- `data-ui="v2"` present → new tokens and component styles apply.
- Absent → current styles apply unchanged.
- A hidden dev toggle flips it, so any screen can be compared side by side.
- Phase 6 deletes the v1 branch. Rollback before that is one attribute.

This also makes the visual diff harness trivial: same build, two attributes.

## Regression guard

- `plans/mockup/diffs/` holds before/after Playwright captures per screen at 1440×900 and
  1024×768, generated by `plans/mockup/diff.sh` (written in Phase 1).
- Parity checklist (`plans/mockup/README.md` §6) enumerates every control per component;
  checked off by hand per phase, alongside `plans/CHECKLIST.md`.
- Custom-theme round trip is re-tested every phase: create a custom theme in the old UI,
  load it in v2, confirm all 7 keys map.

## Risks

| Risk                                           | Mitigation                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Saved custom themes break under new tokens     | derive everything from the 7 keys; test round trip every phase          |
| `color-mix()` unsupported in the Tauri WebView | Phase 0 spike; fallback is precomputed alpha layers                     |
| Frame editor regression (1,863 lines)          | markup-only changes; parity checklist; diff captures                    |
| 6,174-line stylesheet fights the new system    | `data-ui="v2"` coexistence, consolidate in Phase 6, not during redesign |
| Type scale increase breaks fixed layouts       | density is a token (`--row-h`), not hard-coded heights                  |
| Mockup drifts from what React can render       | mockups use real component names; every frame maps to a file in §6      |

## Out of scope

New features, new views, data model changes, mobile, onboarding, icon set redesign (icons are
swapped in Phase 6 only if the mockups demand it).
