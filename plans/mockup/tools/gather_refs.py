#!/usr/bin/env python3
"""Collect reference UI screenshots for the Sprite Studio redesign mockups.

Two sources, in priority order:
  1. seed  - direct image URLs already verified to be official product UI
  2. bing  - image search, quoted product name + size filter (no type filter:
             filterui:photo-photo excludes screenshots and matches literal words)
Downloads candidates, filters by resolution, keeps the best per product,
writes manifest.json, and builds contact_sheet.png for one-pass review.
"""
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw

ROOT = "/home/maximog/GITHUB/sprite-generator/plans/mockup"
RAW = os.path.join(ROOT, "raw")
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"

MIN_W, MIN_H = 1000, 560
PER_QUERY = 14
KEEP = 3

# name -> {product page, search query, seed image urls}
REFS = {
    "aseprite": {
        "product": "https://www.aseprite.org/",
        "query": '"aseprite" editor interface screenshot ui',
        "seeds": [
            "https://images.ctfassets.net/fczckc3dt6mv/5ZbLJhBOCg00VcaWExJ4se/fe78c291f955fe7139cc6bfe5435ca24/aseprite-interface.png?w=2400&q=80",
            "https://ilkke.net/heartfolio/assets/images/aseprite-screenshot-3-ui-1920x1054.png",
        ],
    },
    "pixelmator-pro": {
        "product": "https://www.apple.com/pixelmator-pro/",
        "query": '"pixelmator pro" interface dark mode screenshot',
        "seeds": ["https://cdn.macstories.net/001/2018-10-17-09-10-25.png"],
    },
    "rive": {
        "product": "https://rive.app/docs/editor/interface-overview/overview",
        "query": '"rive" editor interface overview screenshot',
        "seeds": [],
    },
    "jitter": {
        "product": "https://jitter.video/",
        "query": '"jitter.video" OR "jitter" motion design editor interface',
        "seeds": [],
    },
    "cavalry": {
        "product": "https://cavalrygraphics.com/",
        "query": '"cavalry" motion design software interface screenshot',
        "seeds": ["https://content-management-files.canva.com/84af5b71-6fe2-4084-b633-8cd719dd2a38/CavalryUI.png"],
    },
    "photopea": {
        "product": "https://www.photopea.com/",
        "query": '"photopea" interface screenshot dark panels',
        "seeds": ["https://user-images.githubusercontent.com/34019878/194753378-e924fa5c-5100-4d5b-ba34-c8b2b3bd906f.png"],
    },
    "godot": {
        "product": "https://godotengine.org/",
        "query": '"godot engine" 4 editor interface screenshot dark',
        "seeds": ["https://godotengine.org/storage/releases/4.5/images/godot_wayland-multiwin.webp"],
    },
    "blender": {
        "product": "https://www.blender.org/",
        "query": '"blender" 4.x interface layout screenshot editor',
        "seeds": ["https://developer.blender.org/docs/release_notes/4.4/images/studio_lights_editor_layout.png"],
    },
    "affinity-photo": {
        "product": "https://affinity.serif.com/",
        "query": '"affinity photo 2" interface screenshot dark',
        "seeds": ["https://cdn.serif.com/affinity/img/learn/quickstart/photo/photo-desktop-header-280920231547--lg@2x.png"],
    },
    "linear": {
        "product": "https://linear.app/",
        "query": '"linear.app" interface screenshot dark issue',
        "seeds": [
            "https://cdn.sanity.io/images/ornj730p/production/4440f7f7cd02950e5e71be841b9cdbf20ec7a9c5-2352x1656.png?q=95&auto=format",
            "https://cdn.sanity.io/images/ornj730p/production/1c2f3f91189293781b8173e4440e5f9f4501645a-1094x766.png?q=95&auto=format",
        ],
    },
    "raycast": {
        "product": "https://www.raycast.com/",
        "query": '"raycast" launcher interface screenshot dark theme',
        "seeds": [
            "https://manual.raycast.com/_next/image?url=https%3A%2F%2Ffz1sd71lwhbqy6sh.public.blob.vercel-storage.com%2Fraycast%2Fimages%2Fapp%2Fthemes%2Fmac-root-dark.png&w=1920&q=75",
        ],
    },
    "figma": {
        "product": "https://www.figma.com/",
        "query": '"figma" editor interface canvas layers panel screenshot',
        "seeds": [],
    },
    "spline": {
        "product": "https://spline.design/",
        "query": '"spline.design" 3d editor interface screenshot',
        "seeds": ["https://d33wubrfki0l68.cloudfront.net/d1e95826da65f8f8ad2184af7ab9ff3d7a2610cd/24f6e/_assets/_images/spline_app_ui_03.png"],
    },
    "procreate": {
        "product": "https://procreate.com/ipad",
        "query": '"procreate" interface layers canvas screenshot',
        "seeds": ["https://procreate-assets-cdn.procreate.art/img/whats-new-2_en.60908c4.jpg"],
    },
    "tldraw": {
        "product": "https://www.tldraw.com/",
        "query": '"tldraw" editor interface screenshot',
        "seeds": [],
    },
}


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("content-type", "")


def bing(query):
    q = urllib.parse.quote(query)
    url = f"https://www.bing.com/images/search?q={q}&form=HDRSC2&qft=+filterui:imagesize-large"
    body, _ = get(url)
    text = body.decode("utf-8", "replace")
    imgs = [html.unescape(m[1]) for m in re.finditer(r'murl&quot;:&quot;(https?://[^"]+?)&quot;', text)]
    pages = [html.unescape(m[1]) for m in re.finditer(r'purl&quot;:&quot;(https?://[^"]+?)&quot;', text)]
    return [{"img": u, "page": pages[i] if i < len(pages) else None} for i, u in enumerate(imgs[:PER_QUERY])]


def ext_for(ct):
    return {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(ct, ".img")


def main():
    os.makedirs(RAW, exist_ok=True)
    for f in os.listdir(RAW):  # start clean; previous run was polluted
        os.remove(os.path.join(RAW, f))
    manifest = {}
    for name, spec in REFS.items():
        cands = [{"img": s, "page": spec["product"], "seed": True} for s in spec["seeds"]]
        try:
            cands += bing(spec["query"])
        except Exception as e:  # noqa: BLE001
            print(f"{name}: search failed {e}")
        kept, seen = [], set()
        for idx, c in enumerate(cands):
            if len(kept) >= KEEP:
                break
            try:
                data, ct = get(c["img"])
            except Exception:  # noqa: BLE001
                continue
            if not ct.startswith("image/") or ct == "image/gif":
                continue
            try:
                im = Image.open(io.BytesIO(data))
                im.load()
            except Exception:  # noqa: BLE001
                continue
            w, h = im.size
            if w < MIN_W or h < MIN_H:
                continue
            key = (w, h)
            if key in seen:
                continue
            seen.add(key)
            fn = f"{name}-{len(kept) + 1}{ext_for(ct)}"
            with open(os.path.join(RAW, fn), "wb") as fh:
                fh.write(data)
            kept.append({"file": fn, "w": w, "h": h, "bytes": len(data), "img": c["img"], "page": c.get("page"), "seed": c.get("seed", False)})
        manifest[name] = {"product": spec["product"], "query": spec["query"], "kept": kept}
        print(f"{name}: kept {len(kept)} -> {[k['file'] for k in kept]}")

    with open(os.path.join(ROOT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    files = sorted(f for f in os.listdir(RAW) if not f.startswith("contact"))
    cols, thumb_w, pad, label_h = 4, 340, 10, 26
    thumbs = []
    for f in files:
        try:
            im = Image.open(os.path.join(RAW, f)).convert("RGB")
        except Exception:  # noqa: BLE001
            continue
        r = thumb_w / im.width
        thumbs.append((f, im.resize((thumb_w, max(1, int(im.height * r))))))
    rows = (len(thumbs) + cols - 1) // cols
    cell_h = 210 + label_h
    sheet = Image.new("RGB", (cols * (thumb_w + pad) + pad, rows * (cell_h + pad) + pad), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, (f, t) in enumerate(thumbs):
        cx = pad + (i % cols) * (thumb_w + pad)
        cy = pad + (i // cols) * (cell_h + pad)
        sheet.paste(t, (cx, cy))
        d.text((cx + 2, cy + 210), f, fill=(230, 230, 230))
    sheet.save(os.path.join(ROOT, "contact_sheet.png"))
    print(f"\ncontact sheet: {sheet.size}, {len(thumbs)} thumbs")


if __name__ == "__main__":
    sys.exit(main())
