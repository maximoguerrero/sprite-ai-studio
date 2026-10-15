# Sprite Video Animation — Plan

Generate sprite animations with xAI video models (`https://api.x.ai`), then extract individual frames and let the user select which ones become animation frames. Output flows into the existing FrameEditor timeline and sprite-sheet export. No video re-encoding anywhere — video is only decoded for frame extraction.

## API integration (xAI)

- `POST /v1/videos/generations` → `request_id`; poll `GET /v1/videos/{request_id}` until `done` / `failed`; result is a **temporary mp4 URL** — download the blob immediately.
- Mode: **image-to-video** (animate the card's generated asset or project anchor so identity is preserved).
- Optional (grok-imagine-video-1.5): pin **first & last frame** (or keyframes on a 1/3s grid) to force a seamless loop. Verified REST shape: `image: {url}` + `last_frame: {url}` (same image = loop); `keyframes: [{image:{url}, timestamp_s}]`, max 4, strictly inside the clip.
- Settings: `aspect_ratio: "1:1"`, `resolution: "480p"` (frames are downscaled to card canvas size anyway), `duration: 2–6s`, `generate_audio: false`.
- Async job fits the existing `useGenerationJobs` queue (submit → poll → store blob → update card).

## Cost per generation

Billed per second of requested video, not per frame kept.

| Model                                     | Rate     | 2s    | 4s        | 6s    | 8s    |
| ----------------------------------------- | -------- | ----- | --------- | ----- | ----- |
| grok-imagine-video-1.5-lite (recommended) | $0.020/s | $0.04 | **$0.08** | $0.12 | $0.16 |
| grok-imagine-video                        | $0.050/s | $0.10 | $0.20     | $0.30 | $0.40 |
| grok-imagine-video-1.5                    | $0.080/s | $0.16 | $0.32     | $0.48 | $0.64 |

Typical per-animation budget with 1–2 retries on lite: **~$0.10–0.25**. Text prompt rewrites add <$0.01.

## Frame extraction — no ffmpeg

Decode only, never re-encode:

1. Download mp4 blob → `URL.createObjectURL` → `<video>` element.
2. Step `currentTime` by `1/fps`, `canvas.drawImage(video)`, `canvas.toBlob()` → `imageStore.saveImage()`.
3. User picks frames from the sampled strip; selected frames become `StudioFrame` records.

Notes:

- Seeking is keyframe-approximate on some codecs — acceptable because selection is visual.
- Linux Tauri (WebKitGTK) may lack H.264 decode. Fallback order: WebCodecs + mp4box.js (frame-accurate, still no ffmpeg) → ffmpeg sidecar binary as last resort. Never ffmpeg.wasm.
- Store the mp4 as a card asset (`video-<cardId>-<id>`) so extraction can be re-run without regenerating.

## Phases & estimate (~6–10 dev-days)

| Phase                         | Scope                                                                                                                                                                                     | Estimate   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0 — Spike ✅                  | Provider settings: add "Video generation" to the Grok model-type dropdown; canvas-seek extraction on a real xAI mp4 in browser + Tauri webviews; validate loop prompts on a sample sprite | 1–1.5 days |
| 1 — API plumbing              | Provider profile `videoModel` + capability flag; `video-animation` job target (submit/poll/download before URL expiry); cost estimate in confirm dialog                                   | 1–2 days   |
| 2 — Video storage & preview   | Save mp4 blob via imageStore/desktop files; `videoVersions` on card; preview panel with scrubber                                                                                          | 1 day      |
| 3 — Extraction & selection UI | Sample ~16 thumbnails, click-to-select, preview at card canvas size, "Add selected to frames" → FrameEditor timeline                                                                      | 2–3 days   |
| 4 — Sprite tooling            | Loop prompt presets, first/last-frame pinning for seamless loops, duration/fps controls, anchor/asset → video one-click                                                                   | 1–2 days   |
| 5 — Polish                    | Cancel handling, xAI error codes (`invalid_argument`, `service_unavailable`…), orphan video-blob GC, desktop export, tests                                                                | 1–2 days   |

Biggest risk: Phase 0 codec support on Linux Tauri.

## Checklist

### Phase 0 — Spike

- [x] Provider settings: add **Video generation** option to the "Model type" (`modelKind`) dropdown for Grok profiles (`image | text | video`)
- [x] Add a "Video model ID" field for Grok profiles (e.g. `grok-imagine-video-1.5-lite`), mirroring the existing "Image model ID" field
- [x] Model detection: classify `grok-imagine-video*` IDs as `kind: "video"` so they appear labeled in the model datalist suggestions
- [x] Persist `videoModel` on the provider profile type + settings form save/load
- [x] Spike tooling: `src/videoProvider.ts` (submit/poll/download) + "Grok video test" panel in Settings (generate clip, extract 8 frames via canvas seek, download PNGs)
- [x] Generate one test clip — done with `grok-imagine-video` 4s 1:1 (cost confirmed: `cost_in_usd_ticks: 2000000000` = $0.20; use `grok-imagine-video-1.5-lite` for $0.08)
- [x] Download mp4 and extract frames via `<video>` + canvas seek in Chrome/browser — spike panel "Load mp4" + "Extract 8 frames" working
- [ ] Verify decode + extraction in Tauri (Windows/macOS/Linux webviews) — deferred to Phase 2 (browser path proven; Tauri uses same code via `download_grok_image` + Rust proxy)
- [x] Record fps and seek accuracy — 8 evenly-spaced seeks over a 4s clip landed correctly; no keyframe drift observed at this sample rate
- [ ] Test one loop prompt: "fixed camera, character centered, identical first and last pose" — prompt submitted; loop quality not yet judged
- [x] Poll response shape: `{"status":"done","video":{"url":"https://vidgen.x.ai/…mp4","duration":N}}` — URL at `video.url`, temporary host `vidgen.x.ai`
- [x] Key permission note: this xAI key gets 403 on `/v1/models`; app falls back to built-in Grok model list (`grokKnownModels`)

### Phase 1 — API plumbing

- [x] Wire the Phase 0 `videoModel` into generation: only Grok profiles with a video model can start video jobs
- [x] Add `video-animation` target to generation job types
- [x] Implement submit + manual polling with progress in `useGenerationJobs` (`waitForVideo` in `videoProvider.ts`, 4s poll, progress mapped 15→90%)
- [x] Download mp4 blob to imageStore before the temporary URL expires (key `video-<jobId>`, attached to `card.videoVersions`)
- [x] Cost estimate (`duration × rate`) in the window.confirm dialog
- [x] Map xAI failure codes to user-facing messages (`videoErrorMessage`)

### Phase 2 — Video storage & preview

- [x] Save mp4 blob with key `video-<jobId>` (IndexedDB; desktop export writes project files as usual)
- [x] Add `videoVersions` (id, imageKey, prompt, model, duration, createdAt) to card type — optional field, no migration needed
- [x] Video preview strip in FrameEditor: clip buttons + native `<video controls>` player (play/pause + scrubber)
- [x] GC video blobs on card delete and per-clip delete (`deleteVideoClip`)

### Phase 3 — Extraction & selection UI

- [x] Sample ~16 evenly spaced frames into a thumbnail strip (8/12/16/24 selector; canvas seek at card canvas size, nearest-neighbor; optional green-screen keying)
- [x] Click-to-toggle frame selection; show count
- [x] Side-by-side preview of a selected frame at card canvas size
- [x] "Add selected to frames" creates `StudioFrame` records (offsets/pivot/duration defaults)
- [x] Selected frames appear in existing FrameEditor timeline; sprite-sheet export works unchanged

### Phase 4 — Sprite tooling

- [x] Loop prompt preset library entries (generic cycle, idle, walk, run, attack) in `src/data/videoLoopPresets.ts`; selectable on the card (`videoLoopPreset`)
- [x] One-click "animate this asset/anchor" (image-to-video): animation cards animate the anchor, asset cards animate their generated image (`Animate with video` button + clip preview strip)
- [x] First/last-frame pinning option for seamless loops (`last_frame` on `grok-imagine-video-1.5`; same image pinned as both endpoints)
- [x] Duration (2–6s) and sample-fps controls on the card (`videoDuration`, `videoSampleCount` persisted; sample count drives extraction)

### Phase 5 — Polish

- [ ] Cancel mid-generation aborts polling and marks job cancelled
- [ ] Failure retry keeps the same prompt/settings
- [ ] Orphan GC for video blobs and extracted frames not added to a version
- [ ] Desktop export writes selected frames as PNGs
- [ ] Unit tests: frame sampling math, video version normalization, GC reference checks
