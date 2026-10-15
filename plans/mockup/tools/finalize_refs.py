#!/usr/bin/env python3
"""Promote the curated winners into references/ with clean names.

Attribution (source image url + page url) is pulled from manifest.json where the
file came from the scrape; hand-picked files carry their own provenance.
"""
import json
import os
import shutil

ROOT = "/home/maximog/GITHUB/sprite-generator/plans/mockup"
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "references")
SRC = os.path.join(ROOT, "sources")

# clean name -> (source file, product page, why it is in the set)
KEEP = [
    ("aseprite-frames-timeline.png", "aseprite-2.png", "https://www.aseprite.org/",
     "Frame strip + tags + onion skin + palette dock. Closest existing product to Sprite Studio's card/frame model."),
    ("aseprite-canvas-dock.png", "aseprite-1.png", "https://www.aseprite.org/",
     "Compact tool dock, swatch grid, floating panels over a dark neutral canvas."),
    ("rive-editor-full.png", "rive-doc-2.png", "https://rive.app/docs/editor/interface-overview/overview",
     "The layout to copy: left asset tree, center canvas, right inspector, bottom timeline. Neutral dark, one accent."),
    ("rive-asset-panel.png", "rive-doc-1.png", "https://rive.app/docs/editor/interface-overview/overview",
     "Asset grid with search + category rail; how to present generated cards."),
    ("linear-app-chrome.png", "linear-2.png", "https://linear.app/blog/how-we-redesigned-the-linear-ui",
     "Reference for type scale, row density, keyboard-first affordances, context menus."),
    ("linear-theme-compare.png", "linear-1.png", "https://linear.app/",
     "Two neutral dark themes side by side; model for our theme presets."),
    ("pixelmator-pro-layout.png", "pixelmator-pro-doc-3.png", "https://www.apple.com/pixelmator-pro/",
     "Canvas-dominant layout, right stacked inspector, thin toolbar. The 'pro but calm' target."),
    ("pixelmator-pro-layers.png", "pixelmator-pro-doc-4.png", "https://www.apple.com/pixelmator-pro/",
     "Layer list rows: thumbnail, name, visibility, opacity. Model for frame rows."),
    ("affinity-photo-dark.png", "affinity-photo-1.png", "https://affinity.serif.com/",
     "Dense but readable dark chrome; left tool rail, right studio panels."),
    ("photopea-panels.png", "photopea-1.jpg", "https://www.photopea.com/",
     "Panel stacking + floating dialogs + color picker over a dark UI."),
    ("photopea-start.png", "photopea-3.png", "https://www.photopea.com/",
     "Empty-state / welcome screen with a left rail and a tool dock. Model for our WelcomePage."),
    ("procreate-layers.png", "procreate-2.jpg", "https://procreate.com/ipad",
     "Overlay panels that float over the canvas instead of boxing it in."),
    ("procreate-color.png", "procreate-3.jpg", "https://procreate.com/ipad",
     "Palette + color picker presentation."),
    ("blender-inspector.png", "blender-doc-2.png", "https://developer.blender.org/docs/release_notes/4.4/user_interface/",
     "Outliner + property list with tabs; how to group many settings without a wall of inputs."),
    ("cavalry-editor.png", "cavalry-1.png", "https://cavalrygraphics.com/",
     "Motion-tool layout: layers left, inspector right, timeline bottom, low-chrome."),
    ("spline-editor.png", "spline-1.png", "https://spline.design/",
     "Dark editor with a single accent and generous canvas."),
    ("raycast-launcher.png", "raycast-1.png", "https://www.raycast.com/",
     "Command palette / settings list styling; model for our settings + provider picker."),
]

# live captures taken with Playwright (real running apps, not marketing pages)
LIVE = [
    ("piskel-editor.png", "piskel.png", "https://www.piskelapp.com/",
     "Live app. Frame timeline + preview + sprite canvas: the exact information architecture we need."),
    ("photopea-live.png", "photopea.png", "https://www.photopea.com/",
     "Live app. Real proportions of a three-region editor at 1600x1000."),
    ("vscode-chrome.png", "vscode-dev.png", "https://vscode.dev/",
     "Live app. Gold standard for activity bar, sidebar, status bar, and focus rings."),
    ("excalidraw-live.png", "excalidraw.png", "https://excalidraw.com/",
     "Live app. Light-mode canvas tool; useful for the 'academic' light theme."),
]

os.makedirs(OUT, exist_ok=True)
os.makedirs(SRC, exist_ok=True)

manifest = json.load(open(os.path.join(ROOT, "manifest.json"))) if os.path.exists(os.path.join(ROOT, "manifest.json")) else {}
by_file = {}
for name, spec in manifest.items():
    for key in ("kept", "harvested"):
        for e in spec.get(key, []):
            by_file[e["file"]] = e

rows = []
for clean, src, product, why in KEEP + LIVE:
    origin = os.path.join(RAW, src)
    if not os.path.exists(origin):
        origin = os.path.join(ROOT, "references", src)
    if not os.path.exists(origin):
        print(f"MISSING {src}")
        continue
    shutil.copy2(origin, os.path.join(OUT, clean))
    meta = by_file.get(src, {})
    rows.append({
        "file": f"references/{clean}",
        "product": product,
        "image": meta.get("img"),
        "page": meta.get("page") or product,
        "why": why,
    })

# provenance
for f in os.listdir(RAW):
    shutil.move(os.path.join(RAW, f), os.path.join(SRC, f))
if os.path.exists(os.path.join(ROOT, "manifest.json")):
    shutil.move(os.path.join(ROOT, "manifest.json"), os.path.join(SRC, "manifest.json"))

# remove the uncurated captures that are still sitting in references/
final = {os.path.basename(r["file"]) for r in rows} | {"INDEX.md"}
for f in os.listdir(OUT):
    if f not in final:
        os.remove(os.path.join(OUT, f))

rows.sort(key=lambda r: r["file"])
lines = ["| Reference | Product | Why it is here |", "| --- | --- | --- |"]
for r in rows:
    lines.append(f"| `{r['file']}` | [{os.path.basename(r['product'].rstrip('/'))}]({r['product']}) | {r['why']} |")
open(os.path.join(ROOT, "references", "INDEX.md"), "w").write(
    "# Reference set\n\n"
    "Curated screenshots of software with the look we are targeting: **professional creative tools, neutral dark**.\n"
    "Each row links the local copy, the product page, and the reason it is in the set.\n\n"
    + "\n".join(lines) + "\n"
)
print(f"promoted {len(rows)} references")
