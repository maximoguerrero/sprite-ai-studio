import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { AssetVersion, CanvasSize, SavedSkill, StudioCard, VideoVersion } from "../types";
import { deleteImages, loadImage, saveImage } from "../imageStore";
import { canvasPng, downloadBlob, safeFilename } from "../spriteSheet";
import { makeId } from "../lib/ids";
import { renderStillAsset } from "../lib/renderStillAsset";

const DEFAULT_PLACEMENT = { scale: 1, offsetX: 0, offsetY: 0 };

export function StillAssetEditor({
  card,
  canvasSize,
  hasAnchor,
  anchorImageKey,
  availableSkills,
  onClose,
  onUpdate,
  onGenerate,
  generating,
  onDelete,
  onRewritePrompt,
  onDeleteLayer,
  onSelectVersion,
  onGenerateVideo,
  onDeleteVideo,
}: {
  card: StudioCard;
  canvasSize: CanvasSize;
  hasAnchor: boolean;
  anchorImageKey?: string;
  availableSkills: SavedSkill[];
  onClose: () => void;
  onUpdate: (update: Partial<StudioCard>) => void;
  onGenerate: () => void;
  generating: boolean;
  onDelete: () => void;
  onRewritePrompt: (current: { name: string; prompt: string }) => Promise<string>;
  onDeleteLayer: (layerId: string) => void;
  onSelectVersion: (version: AssetVersion) => void;
  onGenerateVideo: () => void;
  onDeleteVideo: (video: VideoVersion) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [mainImage, setMainImage] = useState<HTMLImageElement | null>(null);
  const [layerImages, setLayerImages] = useState<{ layerId: string; image: HTMLImageElement }[]>([]);
  const [layerThumbs, setLayerThumbs] = useState<{ layerId: string; layerIndex: number; url: string }[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [imageSize, setImageSize] = useState({ width: canvasSize.width, height: canvasSize.height });
  const [placement, setPlacement] = useState(card.assetPlacement ?? DEFAULT_PLACEMENT);
  const [crop, setCrop] = useState(card.assetCrop);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [editPrompt, setEditPrompt] = useState(card.prompt);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteMessage, setRewriteMessage] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [anchorUrl, setAnchorUrl] = useState("");
  const [skillToInsert, setSkillToInsert] = useState("");
  const versionList = card.assetVersions ?? [];
  const [activeVideoId, setActiveVideoId] = useState<string | null>(card.videoVersions?.at(-1)?.id ?? null);
  const [videoSrc, setVideoSrc] = useState("");
  const activeVideo = (card.videoVersions ?? []).find((video) => video.id === activeVideoId);
  useEffect(() => {
    let revoke = "";
    let cancelled = false;
    if (!activeVideo) {
      setVideoSrc("");
      return;
    }
    void loadImage(activeVideo.imageKey).then((blob) => {
      if (cancelled || !blob) return;
      revoke = URL.createObjectURL(blob);
      setVideoSrc(revoke);
    });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [activeVideo?.imageKey]);

  useEffect(() => {
    let url = "";
    let cancelled = false;
    const imageKey = card.generatedImageKey;
    if (!imageKey) {
      setImageUrl("");
      setImageSize(canvasSize);
      return;
    }
    void loadImage(imageKey).then((blob) => {
      if (blob && !cancelled) {
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      }
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [card.generatedImageKey]);

  useEffect(() => {
    let url = "";
    let cancelled = false;
    if (!card.referenceImageKey) {
      setReferenceUrl("");
      return;
    }
    void loadImage(card.referenceImageKey).then((blob) => {
      if (blob && !cancelled) {
        url = URL.createObjectURL(blob);
        setReferenceUrl(url);
      }
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [card.referenceImageKey]);

  useEffect(() => {
    let url = "";
    let cancelled = false;
    if (!anchorImageKey) {
      setAnchorUrl("");
      return;
    }
    void loadImage(anchorImageKey).then((blob) => {
      if (blob && !cancelled) {
        url = URL.createObjectURL(blob);
        setAnchorUrl(url);
      }
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [anchorImageKey]);

  useEffect(() => {
    if (!imageUrl) {
      setMainImage(null);
      return;
    }
    const image = new Image();
    image.src = imageUrl;
    void image
      .decode()
      .then(() => {
        setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
        setMainImage(image);
      })
      .catch(() => setMessage("Could not load the generated asset image."));
  }, [imageUrl]);

  const layerUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    const layers = card.assetLayers ?? [];
    if (!layers.length) {
      setLayerImages([]);
      setLayerThumbs([]);
      layerUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      layerUrlsRef.current = [];
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    void Promise.all(
      layers.map(async (layer) => {
        const blob = await loadImage(layer.imageKey);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const image = new Image();
        image.src = url;
        await image.decode().catch(() => undefined);
        return { layerId: layer.id, layerIndex: layer.layerIndex, image, url };
      })
    ).then((entries) => {
      const loaded = entries.filter(
        (entry): entry is { layerId: string; layerIndex: number; image: HTMLImageElement; url: string } =>
          Boolean(entry)
      );
      if (cancelled) {
        urls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      setLayerImages(loaded.map(({ layerId, image }) => ({ layerId, image })));
      setLayerThumbs(loaded.map(({ layerId, layerIndex, url }) => ({ layerId, layerIndex, url })));
      const previous = layerUrlsRef.current;
      layerUrlsRef.current = urls;
      previous.forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      cancelled = true;
    };
  }, [card.assetLayers]);

  useEffect(
    () => () => {
      layerUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      layerUrlsRef.current = [];
    },
    []
  );

  function visibleImages() {
    return (card.assetLayers ?? []).length
      ? layerImages.filter((entry) => !hiddenLayers.includes(entry.layerId)).map((entry) => entry.image)
      : mainImage
        ? [mainImage]
        : [];
  }

  useEffect(() => {
    if (!canvasRef.current) return;
    renderStillAsset(canvasRef.current, visibleImages(), canvasSize, crop, placement);
  }, [mainImage, layerImages, hiddenLayers, card.assetLayers, canvasSize.width, canvasSize.height, crop, placement]);

  useEffect(() => {
    const timer = window.setTimeout(() => onUpdate({ assetPlacement: placement, assetCrop: crop }), 150);
    return () => window.clearTimeout(timer);
  }, [placement, crop]);

  useEffect(() => {
    setEditPrompt(card.prompt);
  }, [card.prompt]);

  function toggleLayer(layerId: string) {
    setHiddenLayers((current) =>
      current.includes(layerId) ? current.filter((id) => id !== layerId) : [...current, layerId]
    );
  }

  async function rewritePrompt() {
    setRewriting(true);
    setRewriteMessage("");
    try {
      const next = await onRewritePrompt({ name: card.name, prompt: editPrompt });
      setEditPrompt(next);
      onUpdate({ prompt: next });
      setRewriteMessage("Prompt rewritten — review it, then generate.");
    } catch (error) {
      setRewriteMessage(error instanceof Error ? error.message : "The rewrite failed.");
    } finally {
      setRewriting(false);
    }
  }

  async function uploadReference(file?: File) {
    if (!file) return;
    const key = `reference-${card.id}-${makeId()}`;
    try {
      await saveImage(key, file);
      const previous = card.referenceImageKey;
      onUpdate({ referenceImageKey: key });
      if (previous) void deleteImages([previous]).catch(() => undefined);
      setMessage("Reference image uploaded — it will guide the next generation.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the reference image.");
    }
  }

  function removeReference() {
    const previous = card.referenceImageKey;
    if (!previous) return;
    onUpdate({ referenceImageKey: undefined });
    void deleteImages([previous]).catch(() => undefined);
    setMessage("Reference image removed.");
  }

  function appendSkill() {
    const skill = availableSkills.find((entry) => entry.id === skillToInsert);
    if (!skill) return;
    const next = editPrompt.trim() ? `${editPrompt.trim()}\n\n${skill.promptTemplate}` : skill.promptTemplate;
    setEditPrompt(next);
    onUpdate({ prompt: next, skillSnapshot: undefined });
    setSkillToInsert("");
    setMessage(
      `Appended the “${skill.name}” prompt template — edit it freely; the prompt text is what gets generated.`
    );
  }

  function changeCrop(field: "x" | "y" | "width" | "height", value: number) {
    const current = crop ?? { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
    const next = { ...current, [field]: value };
    next.x = Math.max(0, Math.min(imageSize.width - 1, next.x));
    next.y = Math.max(0, Math.min(imageSize.height - 1, next.y));
    next.width = Math.max(1, Math.min(imageSize.width - next.x, next.width));
    next.height = Math.max(1, Math.min(imageSize.height - next.y, next.height));
    setCrop(next);
  }

  function selectVersion(version: AssetVersion) {
    setPlacement(DEFAULT_PLACEMENT);
    setCrop(undefined);
    onSelectVersion(version);
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!imageUrl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setPlacement((current) => ({
      ...current,
      offsetX: current.offsetX + (event.movementX * canvasSize.width) / rect.width,
      offsetY: current.offsetY + (event.movementY * canvasSize.height) / rect.height,
    }));
  }

  async function exportPng() {
    if (!imageUrl || !canvasRef.current) return setMessage("Generate an asset before exporting a PNG.");
    downloadBlob(await canvasPng(canvasRef.current), `${safeFilename(card.name)}.png`);
    setMessage("Cropped and placed asset exported as PNG.");
  }

  return (
    <section className="editor-page still-asset-editor">
      <div className="editor-topline">
        <button className="text-button" onClick={onClose}>
          ← Back to project
        </button>
        <span className="tag">STILL ASSET</span>
        <button className="button destructive-button" onClick={onDelete}>
          Delete asset
        </button>
      </div>
      <div className="editor-heading">
        <div>
          <div className="eyebrow">ASSET EDITOR</div>
          <h1>{card.name}</h1>
        </div>
        <div className="editor-actions">
          <button className="button secondary" onClick={onGenerate} disabled={generating}>
            {generating ? "Generating…" : versionList.length ? "Generate variations" : "Generate asset"}
          </button>
          <button className="button secondary" onClick={onGenerateVideo} disabled={!imageUrl}>
            Animate with video
          </button>
          <button className="button primary" onClick={() => void exportPng()} disabled={!imageUrl}>
            Export PNG
          </button>
        </div>
      </div>
      <div className="phase-editor editor-panel asset-prompt-panel">
        <div className="phase-editor-heading">
          <div>
            <span className="eyebrow">ASSET PROMPT</span>
            <small>The prompt and references used for the next generation.</small>
          </div>
        </div>
        <label className="animation-prompt-edit asset-prompt-edit">
          Asset prompt
          <textarea
            value={editPrompt}
            onChange={(event) => setEditPrompt(event.target.value)}
            onBlur={() => onUpdate({ prompt: editPrompt })}
            rows={10}
            placeholder="Describe the asset, style, palette, and background…"
          />
        </label>
        <div className="asset-rewrite-row">
          <button type="button" className="button secondary" disabled={rewriting} onClick={() => void rewritePrompt()}>
            {rewriting ? "Rewriting…" : "Rewrite with text model"}
          </button>
          {rewriteMessage && (
            <small className="skill-rewrite-message" role="status">
              {rewriteMessage}
            </small>
          )}
        </div>
        <label className="asset-anchor-toggle">
          <input
            type="checkbox"
            checked={Boolean(card.useAnchorReference)}
            onChange={(event) => onUpdate({ useAnchorReference: event.target.checked })}
          />{" "}
          Use project anchor as reference
          {anchorUrl && <img className="asset-reference-thumb" src={anchorUrl} alt="Project anchor" />}
          {!hasAnchor && <small>No project anchor yet — upload or generate one in the workspace first.</small>}
        </label>
        <div className="asset-reference-row">
          <label className="button secondary upload-button">
            ↑ Upload reference
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                void uploadReference(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {referenceUrl && <img className="asset-reference-thumb" src={referenceUrl} alt="Card reference" />}
          {card.referenceImageKey && (
            <button type="button" className="text-button" onClick={removeReference}>
              Remove reference
            </button>
          )}
        </div>
        <div className="asset-skill-insert">
          <label>
            Append skill
            <select value={skillToInsert} onChange={(event) => setSkillToInsert(event.target.value)}>
              <option value="">Choose a skill…</option>
              {availableSkills
                .filter(
                  (skill) =>
                    skill.category === "general" || skill.category === "asset" || skill.category === "character"
                )
                .map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                    {skill.projectId ? " · project" : " · global"}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" className="button secondary" disabled={!skillToInsert} onClick={appendSkill}>
            Append skill
          </button>
        </div>
      </div>
      {versionList.length > 0 && (
        <div className="animation-version-strip asset-version-strip">
          <span>Versions</span>
          {versionList.map((version) => (
            <button
              key={version.id}
              className={version.id === card.activeAssetVersionId ? "animation-version active" : "animation-version"}
              aria-pressed={version.id === card.activeAssetVersionId}
              onClick={() => selectVersion(version)}
            >
              <strong>
                v{version.number}
                {version.id === card.activeAssetVersionId ? " · current" : ""}
              </strong>
              <small>{new Date(version.createdAt).toLocaleDateString()}</small>
            </button>
          ))}
        </div>
      )}
      {(card.videoVersions?.length ?? 0) > 0 && (
        <div className="video-clip-strip">
          <div className="video-clip-row">
            <div className="video-clip-list">
              <span>Video clips</span>
              {card.videoVersions?.map((video, index) => (
                <span key={video.id} className="animation-version-cell">
                  <button
                    className={video.id === activeVideoId ? "animation-version active" : "animation-version"}
                    aria-pressed={video.id === activeVideoId}
                    onClick={() => setActiveVideoId(video.id)}
                  >
                    <strong>
                      Clip {index + 1}
                      {video.id === activeVideoId ? " · current" : ""}
                    </strong>
                    <small>
                      {video.duration}s · {video.model.replace("grok-imagine-video", "Grok")}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="version-delete"
                    aria-label={`Delete clip ${index + 1}`}
                    title={`Delete clip ${index + 1}`}
                    onClick={() => onDeleteVideo(video)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {videoSrc && (
              <div className="video-clip-player-frame">
                <video className="video-clip-player" src={videoSrc} controls muted loop playsInline />
              </div>
            )}
          </div>
          <p className="editor-message" role="status">
            This clip animates the current asset image. Open an animation card to extract frames into a timeline.
          </p>
        </div>
      )}
      <div className="asset-editor-layout">
        <section className="preview-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">CANVAS PREVIEW</span>
              <span className="preview-resolution">
                {canvasSize.width} × {canvasSize.height}
              </span>
            </div>
            <span className="preview-resolution">Drag to place</span>
          </div>
          <div className="editor-canvas-wrap">
            <div
              className="editor-canvas checkerboard"
              style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
            >
              <canvas
                ref={canvasRef}
                className="draggable-canvas"
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={() => setDragging(false)}
                onPointerCancel={() => setDragging(false)}
                aria-label="Still asset preview; drag to place"
              />
              {!imageUrl && (
                <div className="canvas-empty">
                  <span>◇</span>
                  <strong>Generate this asset</strong>
                  <small>Original images are kept in asset versions</small>
                </div>
              )}
            </div>
          </div>
          {layerThumbs.length > 0 && (
            <div className="asset-layer-thumbs">
              <span>Layers</span>
              {layerThumbs.map((thumb) => (
                <button
                  key={thumb.layerId}
                  type="button"
                  className={hiddenLayers.includes(thumb.layerId) ? "layer-thumb off" : "layer-thumb"}
                  aria-pressed={!hiddenLayers.includes(thumb.layerId)}
                  onClick={() => toggleLayer(thumb.layerId)}
                  title={hiddenLayers.includes(thumb.layerId) ? "Show layer in preview" : "Hide layer from preview"}
                >
                  <img src={thumb.url} alt={`Layer ${thumb.layerIndex}`} />
                  <strong>L{thumb.layerIndex}</strong>
                  <span
                    role="button"
                    tabIndex={0}
                    className="layer-thumb-delete"
                    aria-label={`Delete layer ${thumb.layerIndex}`}
                    title="Delete layer"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteLayer(thumb.layerId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onDeleteLayer(thumb.layerId);
                      }
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="align-tools">
            <div className="align-label">
              <strong>Placement</strong>
              <span>Scale and offset are stored separately</span>
            </div>
            <label>
              Scale{" "}
              <input
                aria-label="Asset scale"
                type="number"
                min="0.1"
                max="8"
                step="0.1"
                value={placement.scale}
                onChange={(event) =>
                  setPlacement((current) => ({
                    ...current,
                    scale: Math.max(0.1, Math.min(8, Number(event.target.value) || 0.1)),
                  }))
                }
              />
            </label>
            <button className="text-button" onClick={() => setPlacement(DEFAULT_PLACEMENT)}>
              Reset placement
            </button>
          </div>
        </section>
        <aside className="frame-settings asset-edit-settings">
          <div className="panel-header">
            <span className="eyebrow">CROP & PLACEMENT</span>
          </div>
          <p className="asset-source-info">
            Source: {imageSize.width} × {imageSize.height} · original remains unchanged
          </p>
          <div className="asset-layer-control">
            <label>
              Layers{" "}
              <input
                aria-label="Asset layer count"
                type="number"
                min="1"
                max="4"
                step="1"
                value={card.layerCount ?? 1}
                onChange={(event) =>
                  onUpdate({ layerCount: Math.max(1, Math.min(4, Math.floor(Number(event.target.value) || 1))) })
                }
              />
            </label>
            <small>
              Generate up to 4 isolated components from one prompt; they stack in the preview. Use {"{layer}"} or
              [layer] in the prompt to insert the layer number.
            </small>
          </div>
          <div className="asset-crop-fields">
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field}>
                {field.toUpperCase()}
                <input
                  type="number"
                  min={field === "width" || field === "height" ? 1 : 0}
                  max={
                    field === "x"
                      ? imageSize.width - 1
                      : field === "y"
                        ? imageSize.height - 1
                        : field === "width"
                          ? imageSize.width
                          : imageSize.height
                  }
                  value={(crop ?? { x: 0, y: 0, width: imageSize.width, height: imageSize.height })[field]}
                  onChange={(event) => changeCrop(field, Number(event.target.value) || 0)}
                  disabled={!imageUrl}
                />
              </label>
            ))}
          </div>
          <button className="text-button" disabled={!crop || !imageUrl} onClick={() => setCrop(undefined)}>
            Reset crop to source
          </button>
          <div className="setting-divider" />
          <div className="selected-frame-info">
            <span>Offset X</span>
            <strong>{Math.round(placement.offsetX)} px</strong>
          </div>
          <div className="selected-frame-info">
            <span>Offset Y</span>
            <strong>{Math.round(placement.offsetY)} px</strong>
          </div>
          <div className="selected-frame-info">
            <span>Art mode</span>
            <strong>{card.artMode === "hd" ? "Smooth / HD" : "Pixel art"}</strong>
          </div>
          <div className="selected-frame-info">
            <span>Background</span>
            <strong>{card.transparentBackground === false ? "Solid" : "Transparent"}</strong>
          </div>
          {(card.assetLayers ?? []).length > 0 && (
            <div className="selected-frame-info">
              <span>Generated layers</span>
              <strong>{(card.assetLayers ?? []).length} stacked</strong>
            </div>
          )}
        </aside>
      </div>
      {message && (
        <p className="editor-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
