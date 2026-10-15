import { activeFrameImageKey, type SpriteSize, type StudioCard } from "../types";
import { normalizedCanvas } from "../productFoundation";
import { GeneratedAssetPreview } from "./GeneratedAssetPreview";

export function CardTile({
  card,
  size,
  onOpen,
  onGenerate,
  generating,
  actions = [],
}: {
  card: StudioCard;
  size: SpriteSize;
  onOpen?: () => void;
  onGenerate?: () => void;
  generating?: boolean;
  actions?: Array<{ label: string; run: () => void; disabled?: boolean }>;
}) {
  const dimensions = normalizedCanvas(card.size ?? size, card.canvasSize);
  const sizeLabel = `${dimensions.width} × ${dimensions.height}`;
  const deleteAction = actions.find((action) => action.label === "Delete");
  const thumbnailFrame = card.thumbnailFrameId
    ? ((card.frames ?? []).find((frame) => frame.id === card.thumbnailFrameId) ??
      (card.versions ?? []).flatMap((version) => version.frames).find((frame) => frame.id === card.thumbnailFrameId))
    : undefined;
  const thumbnailImageKey = thumbnailFrame ? activeFrameImageKey(thumbnailFrame) : card.generatedImageKey;
  return (
    <article className="card-tile clickable-card">
      <div className="card-art-wrap">
        <button className="card-open-target" onClick={onOpen} aria-label={`Open ${card.name}`}>
          <div className="card-art">
            {thumbnailImageKey ? (
              <GeneratedAssetPreview imageKey={thumbnailImageKey} name={card.name} />
            ) : (
              <div className="card-art-grid">
                <span>{card.kind === "animation" ? "◌" : "◇"}</span>
              </div>
            )}
            <span className={`card-kind ${card.kind}`}>{card.kind}</span>
            {thumbnailFrame && (
              <span className="card-thumbnail-flag" title="Thumbnail from a marked animation frame">
                frame
              </span>
            )}
          </div>
        </button>
        {deleteAction && (
          <button
            type="button"
            className="card-direct-delete"
            aria-label={`Delete ${card.name}`}
            title={`Delete ${card.name}`}
            onClick={(event) => {
              event.stopPropagation();
              deleteAction.run();
            }}
          >
            ×
          </button>
        )}
      </div>
      <div className="card-tile-info">
        <div>
          <h3>{card.name}</h3>
          <p>{card.prompt || (card.kind === "animation" ? "Add a motion prompt" : "Add an asset prompt")}</p>
        </div>
        {actions.length > 0 && (
          <details className="card-actions-menu" onClick={(event) => event.stopPropagation()}>
            <summary aria-label={`${card.name} actions`}>•••</summary>
            <div>
              {actions.map((action) => (
                <button key={action.label} disabled={action.disabled} onClick={action.run}>
                  {action.label}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
      <div className="card-tile-meta">
        <span className="draft-dot" />{" "}
        {card.frames?.length ? `${card.frames.length} frames` : card.generatedImageKey ? "Generated" : "Draft"}{" "}
        <span>·</span> {sizeLabel}
        {onGenerate && (
          <button className="generate-card-button" onClick={onGenerate} disabled={generating}>
            {generating ? "Generating…" : card.generatedImageKey ? "Regenerate" : "Generate"}
          </button>
        )}
      </div>
      {card.kind === "animation" && onOpen && (
        <button className="card-generate-animation" onClick={onGenerate} disabled={!onGenerate}>
          {card.versions?.length ? "Generate new version" : "Generate animation"}
        </button>
      )}
    </article>
  );
}
