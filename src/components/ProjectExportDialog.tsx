import { useState } from "react";
import { zipSync } from "fflate";
import { activeFrameImageKey, type StudioCard, type StudioProject } from "../types";
import { loadImage } from "../imageStore";
import { normalizedCanvas } from "../productFoundation";
import {
  canvasPng,
  downloadBlob,
  renderCombinedSheet,
  renderSheet,
  safeFilename,
  type CombinedLayout,
  type ExportAnimation,
} from "../spriteSheet";
import { Dialog } from "./Dialog";

export function ProjectExportDialog({ project, onClose }: { project: StudioProject; onClose: () => void }) {
  const availableCards = project.cards.filter((card) => card.kind === "animation");
  const readyCards = availableCards.filter((card) => (card.frames?.length ?? 0) > 0);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => readyCards.map((card) => card.id));
  const [layout, setLayout] = useState<CombinedLayout>("vertical");
  const [padding, setPadding] = useState(16);
  const [includeCardExports, setIncludeCardExports] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const orderedCards = selectedIds
    .map((id) => readyCards.find((card) => card.id === id))
    .filter((card): card is StudioCard => Boolean(card));
  const frameDimensions = (card: StudioCard) =>
    normalizedCanvas(
      card.size ?? project.size,
      card.canvasSize ?? (card.size === "custom" ? project.canvasSize : undefined)
    );

  function toggleCard(id: string, checked: boolean) {
    setSelectedIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  }

  function moveCard(index: number, delta: number) {
    setSelectedIds((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function exportProject() {
    setBusy(true);
    setMessage("");
    let animations: ExportAnimation[] = [];
    try {
      animations = await Promise.all(
        orderedCards.map(async (card) => {
          const dimensions = frameDimensions(card);
          const activeVersion = card.versions?.find((version) => version.id === card.activeVersionId);
          return {
            id: card.id,
            name: card.name,
            cardVersionId: activeVersion?.id ?? card.activeVersionId,
            anchorVersionId: activeVersion?.anchorVersionId ?? card.anchorVersionId ?? project.anchorVersionId,
            fps: card.fps ?? 8,
            loop: card.loop ?? true,
            width: dimensions.width,
            height: dimensions.height,
            frames: await Promise.all(
              (card.frames ?? []).map(async (frame) => {
                const blob = await loadImage(activeFrameImageKey(frame));
                if (!blob) throw new Error(`Missing frame image in “${card.name}”: ${frame.name}`);
                const image = new Image();
                image.src = URL.createObjectURL(blob);
                await image.decode();
                return { ...frame, image };
              })
            ),
          };
        })
      );
      const { canvas, animations: atlasAnimations } = renderCombinedSheet(animations, layout, padding);
      const imageBlob = await canvasPng(canvas);
      const filename = `${safeFilename(project.name)}-combined`;
      const atlas = {
        schema: "sprite-studio-atlas/v1",
        meta: {
          app: "Sprite Studio",
          format: "RGBA8888",
          size: { width: canvas.width, height: canvas.height },
          scale: 1,
        },
        project: { id: project.id, name: project.name },
        sheet: { file: `${filename}.png`, layout, padding },
        animations: atlasAnimations.map((animation) => ({ ...animation, layout, padding })),
      };
      if (includeCardExports) {
        const files: Record<string, Uint8Array> = {
          [`${filename}.png`]: new Uint8Array(await imageBlob.arrayBuffer()),
          [`${filename}.json`]: new TextEncoder().encode(JSON.stringify(atlas, null, 2)),
        };
        for (const animation of animations) {
          const dimensions = { width: animation.width, height: animation.height };
          const columns = animation.frames.length;
          const { canvas: cardSheet, atlasFrames } = renderSheet(
            animation.frames,
            dimensions.width,
            dimensions.height,
            columns
          );
          const cardFilename = `${safeFilename(animation.name)}-${safeFilename(animation.id)}`;
          files[`cards/${cardFilename}.png`] = new Uint8Array(await (await canvasPng(cardSheet)).arrayBuffer());
          files[`cards/${cardFilename}.json`] = new TextEncoder().encode(
            JSON.stringify(
              {
                meta: {
                  app: "Sprite Studio",
                  format: "RGBA8888",
                  size: { width: cardSheet.width, height: cardSheet.height },
                  scale: 1,
                },
                animation: {
                  name: animation.name,
                  fps: animation.fps,
                  loop: animation.loop,
                  cardVersionId: animation.cardVersionId,
                  anchorVersionId: animation.anchorVersionId,
                },
                frames: atlasFrames,
              },
              null,
              2
            )
          );
        }
        downloadBlob(new Blob([zipSync(files)], { type: "application/zip" }), `${filename}.zip`);
      } else {
        downloadBlob(imageBlob, `${filename}.png`);
        downloadBlob(new Blob([JSON.stringify(atlas, null, 2)], { type: "application/json" }), `${filename}.json`);
      }
      setMessage(
        includeCardExports
          ? "Combined and individual card exports downloaded in a ZIP."
          : "Combined sprite sheet and versioned atlas downloaded."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project export failed.");
    } finally {
      animations?.forEach((animation) => animation.frames.forEach((frame) => URL.revokeObjectURL(frame.image.src)));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Combined project export" onClose={onClose}>
      <div className="project-export-dialog">
        <p className="export-intro">
          Combine selected animation cards into one sheet. Each animation keeps its own frame order and metadata.
        </p>
        {availableCards.length === 0 ? (
          <div className="export-empty">
            Create an animation card and import frames before exporting a combined sheet.
          </div>
        ) : (
          <>
            <div className="export-card-list">
              {availableCards.map((card) => {
                const included = selectedIds.includes(card.id);
                const selectedIndex = selectedIds.indexOf(card.id);
                return (
                  <label
                    key={card.id}
                    className={`export-card-row ${included ? "included" : ""} ${!card.frames?.length ? "unavailable" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={!card.frames?.length}
                      onChange={(event) => toggleCard(card.id, event.target.checked)}
                    />
                    <span className="export-card-name">
                      <strong>{card.name}</strong>
                      <small>
                        {card.frames?.length
                          ? `${card.frames.length} frames · ${card.fps ?? 8} FPS · ${frameDimensions(card).width}×${frameDimensions(card).height}`
                          : "No imported frames yet"}
                      </small>
                    </span>
                    {included && (
                      <span className="order-controls">
                        <button
                          type="button"
                          aria-label={`Move ${card.name} up`}
                          disabled={selectedIndex === 0}
                          onClick={(event) => {
                            event.preventDefault();
                            moveCard(selectedIndex, -1);
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${card.name} down`}
                          disabled={selectedIndex === selectedIds.length - 1}
                          onClick={(event) => {
                            event.preventDefault();
                            moveCard(selectedIndex, 1);
                          }}
                        >
                          ↓
                        </button>
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="export-options">
              <label>
                Sheet layout
                <select value={layout} onChange={(event) => setLayout(event.target.value as CombinedLayout)}>
                  <option value="vertical">Vertical — cards stacked</option>
                  <option value="horizontal">Horizontal — cards side by side</option>
                  <option value="grid">Grid — compact arrangement</option>
                </select>
              </label>
              <label>
                Spacing
                <input
                  type="number"
                  min="0"
                  max="256"
                  value={padding}
                  onChange={(event) => setPadding(Math.max(0, Number(event.target.value) || 0))}
                />
                <small>pixels between cards</small>
              </label>
            </div>
            <label className="include-card-exports">
              <input
                type="checkbox"
                checked={includeCardExports}
                onChange={(event) => setIncludeCardExports(event.target.checked)}
              />{" "}
              Include individual card sheets and atlases in ZIP
            </label>
            <p className="export-summary">
              {orderedCards.length} animation{orderedCards.length === 1 ? "" : "s"} selected · each uses its own frame
              canvas
            </p>
          </>
        )}
        {message && (
          <p className="export-message" role="status">
            {message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || orderedCards.length === 0}
            onClick={() => void exportProject()}
          >
            {busy ? "Exporting…" : "Export PNG + atlas"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
