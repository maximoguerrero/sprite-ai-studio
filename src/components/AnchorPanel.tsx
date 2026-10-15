import type { AnchorVersion, CanvasSize, StudioProject } from "../types";
import { AnchorPreview } from "./AnchorPreview";
import { ArtModePicker } from "./ArtModePicker";
import { ViewDirectionPicker } from "./ViewDirectionPicker";

export function AnchorPanel({
  project,
  activeCanvas,
  providerConfigured,
  isGeneratingAnchor,
  onAnchor,
  onGenerateAnchor,
  onEditAnchor,
  onSelectAnchorVersion,
  onDeleteAnchorVersion,
  onUpdateAnchorMetadata,
}: {
  project: StudioProject;
  activeCanvas: CanvasSize;
  providerConfigured: boolean;
  isGeneratingAnchor: boolean;
  onAnchor: (file?: File) => void;
  onGenerateAnchor: (prompt: string) => void;
  onEditAnchor: (prompt: string) => void;
  onSelectAnchorVersion: (version: AnchorVersion) => void;
  onDeleteAnchorVersion: (version: AnchorVersion) => void;
  onUpdateAnchorMetadata: (field: "artMode" | "direction" | "pivot", value: string | { x: number; y: number }) => void;
}) {
  return (
    <>
      <article className="anchor-panel">
        <div className="anchor-preview">
          <AnchorPreview
            imageKey={project.anchorVersions?.find((version) => version.id === project.anchorVersionId)?.imageKey}
            dataUrl={project.anchorPreview}
            name={project.anchorName}
          />
        </div>
        <div className="anchor-details">
          <div className="eyebrow">CANONICAL VISUAL REFERENCE</div>
          <h2>{project.anchorName}</h2>
          <p>
            {project.anchorPrompt ||
              "Upload a reference or generate an anchor. Existing cards stay pinned to their original anchor version."}
          </p>
          <div className="anchor-actions">
            <label className="button secondary upload-button">
              ↑ Upload anchor
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => onAnchor(event.target.files?.[0])}
              />
            </label>
            <button
              className="text-button"
              onClick={() => {
                const prompt = window.prompt("Describe the anchor image to generate");
                if (prompt?.trim()) onGenerateAnchor(prompt.trim());
              }}
              disabled={!providerConfigured || isGeneratingAnchor}
            >
              {isGeneratingAnchor ? "Generating…" : "Generate anchor"}
            </button>
            <button
              className="text-button"
              onClick={() => {
                const prompt = window.prompt("Describe how to edit the current anchor");
                if (prompt?.trim()) onEditAnchor(prompt.trim());
              }}
              disabled={!providerConfigured || !project.anchorVersionId}
            >
              Edit anchor ↗
            </button>
          </div>
          <div className="anchor-art-settings">
            <ArtModePicker
              value={project.anchorArtMode ?? "pixel"}
              onChange={(value) => onUpdateAnchorMetadata("artMode", value)}
            />
            <ViewDirectionPicker
              value={project.anchorDirection ?? "front"}
              onChange={(value) => onUpdateAnchorMetadata("direction", value)}
            />
          </div>
          <div className="anchor-pivot-controls">
            <button
              type="button"
              className="pivot-reset-button"
              onClick={() =>
                onUpdateAnchorMetadata("pivot", {
                  x: Math.round(activeCanvas.width / 2),
                  y: Math.round(activeCanvas.height * 0.9),
                })
              }
              title={`Reset pivot to ${Math.round(activeCanvas.width / 2)}, ${Math.round(activeCanvas.height * 0.9)}`}
            >
              Default pivot <small>Reset</small>
            </button>
            <label>
              X
              <input
                aria-label="Pivot X position"
                type="number"
                value={project.anchorPivot?.x ?? Math.round(activeCanvas.width / 2)}
                onChange={(event) =>
                  onUpdateAnchorMetadata("pivot", {
                    x: Number(event.target.value),
                    y: project.anchorPivot?.y ?? Math.round(activeCanvas.height * 0.9),
                  })
                }
              />
            </label>
            <label>
              Y
              <input
                aria-label="Pivot Y position"
                type="number"
                value={project.anchorPivot?.y ?? Math.round(activeCanvas.height * 0.9)}
                onChange={(event) =>
                  onUpdateAnchorMetadata("pivot", {
                    x: project.anchorPivot?.x ?? Math.round(activeCanvas.width / 2),
                    y: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
        </div>
        <div className="size-pill">
          <span>PROJECT CANVAS</span>
          <strong>
            {activeCanvas.width} × {activeCanvas.height}
          </strong>
        </div>
      </article>
      {(project.anchorVersions?.length ?? 0) > 0 && (
        <div className="anchor-version-strip">
          <span>Anchor versions</span>
          {project.anchorVersions?.map((version, index) => (
            <div
              key={version.id}
              className={version.id === project.anchorVersionId ? "anchor-version active" : "anchor-version"}
            >
              <button
                type="button"
                className="anchor-version-select"
                aria-pressed={version.id === project.anchorVersionId}
                onClick={() => onSelectAnchorVersion(version)}
              >
                <AnchorPreview imageKey={version.imageKey} name={version.name} />
                <strong>
                  v{index + 1}
                  {version.id === project.anchorVersionId ? " · current" : ""}
                </strong>
                <small>{version.name}</small>
              </button>
              <button
                type="button"
                className="anchor-version-delete"
                aria-label={`Delete anchor ${version.name}`}
                title={`Delete ${version.name}`}
                onClick={() => onDeleteAnchorVersion(version)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
