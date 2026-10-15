import { useState } from "react";
import type { AnchorVersion, CanvasSize, CardKind, StudioCard, StudioProject } from "../types";
import { loadImage } from "../imageStore";
import { canvasPng, downloadBlob } from "../spriteSheet";
import { normalizedCanvas } from "../productFoundation";
import { renderStillAsset } from "../lib/renderStillAsset";
import { CardTile } from "./CardTile";
import { WelcomePage } from "./WelcomePage";
import { AnchorPanel } from "./AnchorPanel";

export function Workspace({
  projects,
  project,
  projectDiskPath,
  onCreateProject,
  onChooseProject,
  onCreateCard,
  onAnchor,
  onOpenCard,
  onProjectExport,
  onRenameProject,
  onArchiveProject,
  onRestoreProject,
  archivedProjects,
  showArchived,
  onToggleArchived,
  onGenerateAnchor,
  onEditAnchor,
  isGeneratingAnchor,
  onGenerateAsset,
  onGenerateAnimation,
  generatingCardId,
  providerConfigured,
  onSelectAnchorVersion,
  onDeleteAnchorVersion,
  onUpdateAnchorMetadata,
  onRenameCard,
  onDuplicateCard,
  onMoveCard,
  onArchiveCard,
  onRestoreCard,
  onDeleteCard,
}: {
  projects: StudioProject[];
  project: StudioProject | null;
  onCreateProject: () => void;
  projectDiskPath: string;
  onSelectProject: (id: string) => void;
  onCreateCard: (kind: CardKind) => void;
  onAnchor: (file?: File) => void;
  onChooseProject: () => void;
  onOpenCard: (id: string) => void;
  onProjectExport: () => void;
  onRenameProject: (project: StudioProject) => void;
  onArchiveProject: (project: StudioProject) => void;
  onRestoreProject: (project: StudioProject) => void;
  archivedProjects: StudioProject[];
  showArchived: boolean;
  onToggleArchived: () => void;
  onGenerateAnchor: (prompt: string) => void;
  onEditAnchor: (prompt: string) => void;
  isGeneratingAnchor: boolean;
  onGenerateAsset: (card: StudioCard) => void;
  onGenerateAnimation: (card: StudioCard) => void;
  generatingCardId: string | null;
  providerConfigured: boolean;
  onSelectAnchorVersion: (version: AnchorVersion) => void;
  onDeleteAnchorVersion: (version: AnchorVersion) => void;
  onUpdateAnchorMetadata: (field: "artMode" | "direction" | "pivot", value: string | { x: number; y: number }) => void;
  onRenameCard: (project: StudioProject, card: StudioCard) => void;
  onDuplicateCard: (project: StudioProject, card: StudioCard) => void;
  onMoveCard: (project: StudioProject, cardId: string, offset: number) => void;
  onArchiveCard: (project: StudioProject, card: StudioCard) => void;
  onRestoreCard: (project: StudioProject, card: StudioCard) => void;
  onDeleteCard: (project: StudioProject, card: StudioCard) => void;
}) {
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  async function exportAssetSheet(assets: StudioCard[], size: CanvasSize) {
    if (!assets.length) return;
    const columns = Math.ceil(Math.sqrt(assets.length));
    const rows = Math.ceil(assets.length / columns);
    const sheet = document.createElement("canvas");
    sheet.width = columns * size.width;
    sheet.height = rows * size.height;
    const context = sheet.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    try {
      for (const [index, asset] of assets.entries()) {
        if (!asset.generatedImageKey) continue;
        const blob = await loadImage(asset.generatedImageKey);
        if (!blob) continue;
        const image = new Image();
        image.src = URL.createObjectURL(blob);
        await image.decode();
        const cell = document.createElement("canvas");
        renderStillAsset(
          cell,
          [image],
          size,
          asset.assetCrop,
          asset.assetPlacement ?? { scale: 1, offsetX: 0, offsetY: 0 }
        );
        context.drawImage(cell, (index % columns) * size.width, Math.floor(index / columns) * size.height);
        URL.revokeObjectURL(image.src);
      }
      downloadBlob(await canvasPng(sheet), "project-assets.png");
    } catch {
      return;
    }
  }
  if (!project)
    return (
      <WelcomePage
        projects={projects}
        onCreateProject={onCreateProject}
        onChooseProject={onChooseProject}
        archivedProjects={archivedProjects}
        onRestoreProject={onRestoreProject}
      />
    );

  const activeAnimations = project.cards.filter((card) => card.kind === "animation" && !card.archivedAt);
  const archivedAnimations = project.cards.filter((card) => card.kind === "animation" && card.archivedAt);
  const activeAssets = project.cards.filter((card) => card.kind === "asset" && !card.archivedAt);
  const archivedAssets = project.cards.filter((card) => card.kind === "asset" && card.archivedAt);
  const selectedAssetCards = activeAssets.filter(
    (card) => selectedAssetIds.includes(card.id) && card.generatedImageKey
  );
  const activeCanvas = normalizedCanvas(project.size, project.canvasSize);
  return (
    <section className="project-page">
      <div className="page-heading project-heading">
        <div>
          <div className="eyebrow">PROJECT WORKSPACE</div>
          <h1>{project.name}</h1>
          <p>Anchor your art direction, then create a set of matching sprites and animations.</p>
          <code className="project-disk-path">On disk: {projectDiskPath}</code>
        </div>
        <div className="project-header-actions">
          <button className="button secondary" onClick={() => onRenameProject(project)}>
            Rename
          </button>
          <button className="button secondary" onClick={() => onArchiveProject(project)}>
            Archive
          </button>
        </div>
      </div>
      <AnchorPanel
        project={project}
        activeCanvas={activeCanvas}
        providerConfigured={providerConfigured}
        isGeneratingAnchor={isGeneratingAnchor}
        onAnchor={onAnchor}
        onGenerateAnchor={onGenerateAnchor}
        onEditAnchor={onEditAnchor}
        onSelectAnchorVersion={onSelectAnchorVersion}
        onDeleteAnchorVersion={onDeleteAnchorVersion}
        onUpdateAnchorMetadata={onUpdateAnchorMetadata}
      />
      <div className="cards-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">MOTION LIBRARY</div>
            <h2>
              Animation cards <span className="sub-count">{activeAnimations.length}</span>
            </h2>
          </div>
          <button className="button secondary" onClick={() => onCreateCard("animation")}>
            <span>＋</span> New animation
          </button>
        </div>
        {activeAnimations.length === 0 ? (
          <div className="empty-card-row">
            <div className="empty-card-symbol">◌</div>
            <div>
              <strong>Your animation set starts here</strong>
              <p>
                Create an idle, walk, or custom motion card. Each animation keeps its frames and sprite sheet organized.
              </p>
            </div>
            <button className="text-button" onClick={() => onCreateCard("animation")}>
              Create animation <span>→</span>
            </button>
          </div>
        ) : (
          <div className="card-grid">
            {activeAnimations.map((card, index) => (
              <CardTile
                key={card.id}
                card={card}
                size={project.size}
                onOpen={() => onOpenCard(card.id)}
                onGenerate={providerConfigured ? () => onGenerateAnimation(card) : undefined}
                actions={[
                  { label: "Rename", run: () => onRenameCard(project, card) },
                  { label: "Duplicate", run: () => onDuplicateCard(project, card) },
                  { label: "Move up", run: () => onMoveCard(project, card.id, -1), disabled: index === 0 },
                  {
                    label: "Move down",
                    run: () => onMoveCard(project, card.id, 1),
                    disabled: index === activeAnimations.length - 1,
                  },
                  { label: "Archive", run: () => onArchiveCard(project, card) },
                  { label: "Delete", run: () => onDeleteCard(project, card) },
                ]}
              />
            ))}
            <button className="add-card-tile" onClick={() => onCreateCard("animation")}>
              <span>＋</span>
              <strong>Add animation</strong>
            </button>
          </div>
        )}
        {archivedAnimations.length > 0 && (
          <div className="archived-cards">
            <strong>Archived animations</strong>
            {archivedAnimations.map((card) => (
              <div key={card.id}>
                <span>{card.name}</span>
                <button className="text-button" onClick={() => onRestoreCard(project, card)}>
                  Restore
                </button>
                <button className="text-button destructive" onClick={() => onDeleteCard(project, card)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="cards-section asset-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">PROJECT ASSETS</div>
            <h2>
              Assets <span className="sub-count">{activeAssets.length}</span>
            </h2>
          </div>
          <div className="asset-section-actions">
            <button
              className="button secondary"
              disabled={!selectedAssetCards.length}
              onClick={() => void exportAssetSheet(selectedAssetCards, activeCanvas)}
            >
              Export selected sheet
            </button>
            <button className="button secondary" onClick={() => onCreateCard("asset")}>
              <span>＋</span> New asset
            </button>
          </div>
        </div>
        {activeAssets.length === 0 ? (
          <div className="empty-card-row asset-empty">
            <div className="empty-card-symbol">◇</div>
            <div>
              <strong>Add props, icons, and other game assets</strong>
              <p>Keep standalone generated art grouped in this project alongside the character animations.</p>
            </div>
            <button className="text-button" onClick={() => onCreateCard("asset")}>
              Create asset <span>→</span>
            </button>
          </div>
        ) : (
          <div className="card-grid">
            {activeAssets.map((card) => (
              <div className="asset-card-wrap" key={card.id}>
                <label className="asset-sheet-select">
                  <input
                    aria-label={`Include ${card.name} in asset sheet`}
                    type="checkbox"
                    checked={selectedAssetIds.includes(card.id)}
                    onChange={(event) =>
                      setSelectedAssetIds((current) =>
                        event.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id)
                      )
                    }
                  />{" "}
                  Include in sheet
                </label>
                <CardTile
                  card={card}
                  size={project.size}
                  onOpen={() => onOpenCard(card.id)}
                  onGenerate={providerConfigured ? () => onGenerateAsset(card) : undefined}
                  generating={generatingCardId === card.id}
                  actions={[
                    { label: "Rename", run: () => onRenameCard(project, card) },
                    { label: "Duplicate", run: () => onDuplicateCard(project, card) },
                    { label: "Archive", run: () => onArchiveCard(project, card) },
                    { label: "Delete", run: () => onDeleteCard(project, card) },
                  ]}
                />
              </div>
            ))}
            <button className="add-card-tile" onClick={() => onCreateCard("asset")}>
              <span>＋</span>
              <strong>Add asset</strong>
            </button>
          </div>
        )}
        {archivedAssets.length > 0 && (
          <div className="archived-cards">
            <strong>Archived assets</strong>
            {archivedAssets.map((card) => (
              <div key={card.id}>
                <span>{card.name}</span>
                <button className="text-button" onClick={() => onRestoreCard(project, card)}>
                  Restore
                </button>
                <button className="text-button destructive" onClick={() => onDeleteCard(project, card)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="project-footer">
        <span>{project.folderPath}</span>
        <div>
          <button onClick={onToggleArchived}>
            {showArchived ? "Hide archived" : `Archived projects (${archivedProjects.length})`}
          </button>
          <button onClick={onProjectExport}>
            Combined project export <span>↗</span>
          </button>
        </div>
      </div>
      {showArchived && (
        <div className="archived-projects">
          {archivedProjects.length ? (
            archivedProjects.map((archived) => (
              <div key={archived.id}>
                <span>{archived.name}</span>
                <button className="text-button" onClick={() => onRestoreProject(archived)}>
                  Restore
                </button>
              </div>
            ))
          ) : (
            <p>No archived projects.</p>
          )}
        </div>
      )}
    </section>
  );
}
