#!/usr/bin/env python3
"""Fill reference gaps by harvesting images from official docs/product pages.

Image search was ~40% precision (see gather_refs.py). For the products where it
failed, scrape the product's own documentation page and take the large images.
Keeps the winners from the previous pass, drops the noise, rebuilds the sheet.
"""
import html
import io
import json
import os
import re
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw

ROOT = "/home/maximog/GITHUB/sprite-generator/plans/mockup"
RAW = os.path.join(ROOT, "raw")
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"

KEEP_FROM_PREV = [
    "aseprite-1.png", "aseprite-2.png",
    "affinity-photo-1.png",
    "cavalry-1.png",
    "linear-1.png", "linear-2.png",
    "photopea-1.jpg", "photopea-3.png",
    "procreate-2.jpg", "procreate-3.jpg",
    "raycast-1.png",
    "spline-1.png",
    "blender-1.png",
]

# product -> pages to harvest (official docs first)
HARVEST = {
    "rive": [
        "https://rive.app/docs/editor/interface-overview/overview",
        "https://rive.app/docs/editor/interface-overview/timeline",
    ],
    "godot": [
        "https://docs.godotengine.org/en/stable/getting_started/step_by_step/ui_index.html",
        "https://godotengine.org/releases/4.5/",
        "https://godotengine.org/features/",
    ],
    "blender": [
        "https://developer.blender.org/docs/release_notes/4.4/user_interface/",
        "https://docs.blender.org/manual/en/latest/interface/overview.html",
    ],
    "jitter": [
        "https://jitter.video/",
        "https://help.jitter.video/en/articles/6159911-getting-started",
    ],
    "pixelmator-pro": [
        "https://www.apple.com/pixelmator-pro/",
        "https://www.macstories.net/reviews/pixelmator-pro-updated-with-machine-learning-auto-enhancement-light-and-dark-modes-and-automator-actions/",
    ],
    "figma": [
        "https://help.figma.com/hc/en-us/articles/360040376593-Get-an-overview-of-Figma-s-ui",
        "https://www.figma.com/enterprise/",
    ],
    "spline": ["https://docs.spline.design/", "https://spline.design/"],
    "tldraw": ["https://tldraw.dev/", "https://www.tldraw.com/"],
}

MIN_W, MIN_H = 1000, 560
PER_PAGE = 2


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("content-type", "")


def absolutize(src, base):
    return urllib.parse.urljoin(base, html.unescape(src))


def harvest(page, name):
    body, _ = get(page)
    text = body.decode("utf-8", "replace")
    srcs = []
    for m in re.finditer(r'<img[^>]+(?:src|data-src|data-srcset)="([^"]+)"', text):
        for part in m[1].split(","):
            srcs.append(part.strip().split(" ")[0])
    # next.js / framer image endpoints often carry the real url in a query param
    for m in re.finditer(r'[?&]url=([^"&]+)', text):
        srcs.append(urllib.parse.unquote(m[1]))
    seen, out = set(), []
    for s in srcs:
        if not s or s in seen or s.startswith("data:"):
            continue
        seen.add(s)
        u = absolutize(s, page)
        if not re.search(r"\.(png|jpe?g|webp)(\?|$)", u, re.I):
            continue
        if re.search(r"logo|icon|favicon|avatar|badge|flag|sprite", u, re.I):
            continue
        out.append(u)
    return out


def main():
    manifest_path = os.path.join(ROOT, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}

    # drop noise from the previous pass
    for f in os.listdir(RAW):
        if f not in KEEP_FROM_PREV:
            os.remove(os.path.join(RAW, f))

    for name, pages in HARVEST.items():
        kept = []
        for page in pages:
            try:
                urls = harvest(page, name)
            except Exception as e:  # noqa: BLE001
                print(f"  {name}: {page} -> fetch failed {str(e)[:60]}")
                continue
            got = 0
            for u in urls:
                if got >= PER_PAGE:
                    break
                try:
                    data, ct = get(u)
                except Exception:  # noqa: BLE001
                    continue
                if not ct.startswith("image/") or ct == "image/gif":
                    continue
                try:
                    im = Image.open(io.BytesIO(data))
                    im.load()
                except Exception:  # noqa: BLE001
                    continue
                if im.width < MIN_W or im.height < MIN_H:
                    continue
                ext = {".png": ".png", ".jpg": ".jpg", ".webp": ".webp"}.get(
                    ct.split("/")[-1].replace("jpeg", ".jpg").replace("png", ".png").replace("webp", ".webp"), ".img")
                fn = f"{name}-doc-{len(kept) + 1}{ext}"
                with open(os.path.join(RAW, fn), "wb") as fh:
                    fh.write(data)
                kept.append({"file": fn, "w": im.width, "h": im.height, "bytes": len(data), "img": u, "page": page})
                got += 1
            print(f"  {name}: {page} -> {got} kept of {len(urls)} candidates")
        if kept:
            manifest.setdefault(name, {})["harvested"] = kept
    json.dump(manifest, open(manifest_path, "w"), indent=2)

    files = sorted(f for f in os.listdir(RAW) if not f.startswith(("contact", "sheet")))
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


main()
