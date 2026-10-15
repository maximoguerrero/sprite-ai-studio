import { useRef, useState } from "react";
import type { ProviderProfile } from "../types";
import { submitVideoGeneration, pollVideoGeneration, downloadVideoBlob } from "../videoProvider";
import { blobToDataUrl, removeGreenScreen } from "../lib/imageUtils";

export function VideoSpikePanel({ profile }: { profile: ProviderProfile }) {
  const [model, setModel] = useState(profile.videoModel ?? "grok-imagine-video-1.5-lite");
  const [prompt, setPrompt] = useState(
    "seamless looping animation: a small pixel-art slime bouncing in an idle cycle, fixed camera, character centered on a flat solid background, identical first and last pose, no camera movement"
  );
  const [duration, setDuration] = useState(4);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [mp4Url, setMp4Url] = useState("");
  const [frames, setFrames] = useState<string[]>([]);
  const [keyOut, setKeyOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  async function generate() {
    setBusy(true);
    setFrames([]);
    setVideoUrl("");
    setStatus("Submitting video job…");
    try {
      const requestId = await submitVideoGeneration(profile, { model, prompt, duration });
      setStatus(`Queued (${requestId.slice(0, 8)}…). Polling every 4s…`);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const result = await pollVideoGeneration(profile, requestId);
        if (result.status === "failed")
          throw new Error(
            `Generation failed: ${result.errorCode ?? "unknown"}${result.errorMessage ? ` — ${result.errorMessage}` : ""}`
          );
        if (result.status === "done" && !result.videoUrl)
          throw new Error("Generation finished but no video URL was returned.");
        if (result.videoUrl) {
          setStatus("Downloading mp4…");
          const blob = await downloadVideoBlob(profile, result.videoUrl);
          setVideoUrl(URL.createObjectURL(blob));
          setStatus(`Done: ${(blob.size / 1048576).toFixed(1)} MB. Press extract to test decoding.`);
          setBusy(false);
          return;
        }
        setStatus(`Status: ${result.status}…`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Video generation failed.");
      setBusy(false);
    }
  }

  async function loadFromUrl() {
    setBusy(true);
    setFrames([]);
    setStatus("Downloading mp4…");
    try {
      const blob = await downloadVideoBlob(profile, mp4Url.trim());
      setVideoUrl(URL.createObjectURL(blob));
      setStatus(`Loaded: ${(blob.size / 1048576).toFixed(1)} MB. Press extract to test decoding.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the video URL.");
    } finally {
      setBusy(false);
    }
  }

  async function extractFrames() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) {
      setStatus("Video not ready for extraction.");
      return;
    }
    setStatus("Extracting frames…");
    const samples = 8;
    const urls: string[] = [];
    for (let index = 0; index < samples; index += 1) {
      const time = Math.min((video.duration * index) / samples, video.duration - 0.001);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = time;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) break;
      const scale = Math.min(256 / video.videoWidth, 256 / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.drawImage(video, (256 - width) / 2, (256 - height) / 2, width, height);
      const drawn = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode extracted frame."))),
          "image/png"
        )
      );
      urls.push(await blobToDataUrl(keyOut ? await removeGreenScreen(drawn) : drawn));
    }
    setFrames(urls);
    setStatus(
      `Extracted ${urls.length} frames. Video ${video.videoWidth}×${video.videoHeight}, duration ${video.duration.toFixed(2)}s.`
    );
  }

  return (
    <div className="settings-panel video-spike-panel">
      <div>
        <div className="eyebrow">VIDEO SPIKE</div>
        <h3>Grok video test</h3>
        <p>
          Generate a short clip with the configured video model and extract frames via canvas seeking to validate
          decoding in this webview.
        </p>
        <div className="provider-fields" style={{ marginTop: 10 }}>
          <label className="provider-field">
            Video model
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label className="provider-field">
            Duration
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              <option value={2}>2s</option>
              <option value={4}>4s</option>
              <option value={6}>6s</option>
              <option value={8}>8s</option>
            </select>
          </label>
        </div>
        <label className="provider-field" style={{ marginTop: 8 }}>
          Prompt
          <textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>
        <div className="foundation-actions" style={{ marginTop: 8 }}>
          <button className="button primary" type="button" disabled={busy} onClick={() => void generate()}>
            {busy ? "Generating…" : "Generate test clip"}
          </button>
          <button className="button secondary" type="button" disabled={!videoUrl} onClick={() => void extractFrames()}>
            Extract 8 frames
          </button>
          <label className="provider-field" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={keyOut} onChange={(event) => setKeyOut(event.target.checked)} /> Remove
            green screen
          </label>
          <input
            value={mp4Url}
            onChange={(event) => setMp4Url(event.target.value)}
            placeholder="or paste an mp4 URL (e.g. https://vidgen.x.ai/…)"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button
            className="button secondary"
            type="button"
            disabled={busy || !mp4Url.trim()}
            onClick={() => void loadFromUrl()}
          >
            Load mp4
          </button>
        </div>
        {status && (
          <p className="provider-message" role="status">
            {status}
          </p>
        )}
        {videoUrl && (
          <video ref={videoRef} src={videoUrl} controls muted playsInline style={{ maxWidth: 320, marginTop: 8 }} />
        )}
        {frames.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {frames.map((frame, index) => (
              <a key={index} href={frame} download={`spike-frame-${index + 1}.png`}>
                <img
                  src={frame}
                  width={96}
                  height={96}
                  alt={`Frame ${index + 1}`}
                  style={{ border: "1px solid #888" }}
                />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
