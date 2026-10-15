import type { FormEvent } from "react";
import type { ProviderProfile, StudioProject } from "../types";
import type { ProviderModelInfo } from "../openAIProvider";
import { ProviderSettingsPanel } from "./ProviderSettingsPanel";
import { VideoSpikePanel } from "./VideoSpikePanel";

export function SettingsPage({
  activeProject,
  profiles,
  activeProfile,
  activeProfileId,
  draftType,
  models,
  modelDetails,
  busy,
  message,
  onChoose,
  onSave,
  onTest,
  onLoadModels,
  onDelete,
  onNew,
  onToggleEnabled,
  onExportWorkspaceBackup,
  onRestoreWorkspaceBackup,
  onImportProjectArchive,
  onExportProjectArchive,
  onChooseProjectDirectory,
  missingImageKeys,
  onRecoverMissingImage,
  foundationNotice,
}: {
  activeProject: StudioProject | null;
  profiles: ProviderProfile[];
  activeProfile: ProviderProfile | null;
  activeProfileId: string | null;
  draftType: NonNullable<ProviderProfile["providerType"]>;
  models: string[];
  modelDetails: ProviderModelInfo[];
  busy: boolean;
  message: string;
  onChoose: (id: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTest: () => Promise<void>;
  onLoadModels: () => Promise<void>;
  onDelete: () => Promise<void>;
  onNew: (type?: NonNullable<ProviderProfile["providerType"]>) => void;
  onToggleEnabled: (id: string) => void;
  onExportWorkspaceBackup: () => Promise<void>;
  onRestoreWorkspaceBackup: (file?: File) => Promise<void>;
  onImportProjectArchive: (file?: File) => Promise<void>;
  onExportProjectArchive: (project: StudioProject) => Promise<void>;
  onChooseProjectDirectory: () => Promise<void>;
  missingImageKeys: string[];
  onRecoverMissingImage: (key: string, file?: File) => Promise<void>;
  foundationNotice: string;
}) {
  return (
    <section className="content-page settings-page">
      <div className="settings-page-heading">
        <div className="eyebrow">PREFERENCES</div>
        <h1>Settings</h1>
        <p className="page-intro">Configure generation providers and manage your local workspace.</p>
      </div>
      <ProviderSettingsPanel
        profiles={profiles}
        activeProfile={activeProfile}
        activeProfileId={activeProfileId}
        draftType={draftType}
        models={models}
        modelDetails={modelDetails}
        busy={busy}
        message={message}
        onChoose={(id) => {
          onChoose(id);
        }}
        onSave={(event) => void onSave(event)}
        onTest={() => void onTest()}
        onLoadModels={() => void onLoadModels()}
        onDelete={() => void onDelete()}
        onNew={onNew}
        onToggleEnabled={onToggleEnabled}
      />
      {activeProfile && (activeProfile.providerType === "grok" || /api\.x\.ai/i.test(activeProfile.baseUrl)) && (
        <VideoSpikePanel profile={activeProfile} />
      )}
      <div className="settings-panel">
        <div className="settings-icon">▧</div>
        <div>
          <h3>Default sprite size</h3>
          <p>New projects start at 64 × 64. Project sizes can be 64, 128, 512, or custom.</p>
        </div>
        <span className="tag">64 × 64</span>
      </div>
      <div className="foundation-panel">
        <div>
          <div className="eyebrow">LOCAL WORKSPACE</div>
          <h3>Backup and project folders</h3>
          <p>
            Export a portable workspace backup including project metadata and imported frame images, restore a backup,
            or write project folders to a selected directory.
          </p>
        </div>
        <div className="foundation-actions">
          <button className="button secondary" onClick={() => void onExportWorkspaceBackup()}>
            Download backup
          </button>
          <label className="button secondary backup-import">
            Restore backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                void onRestoreWorkspaceBackup(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <label className="button secondary backup-import">
            Import project archive
            <input
              type="file"
              accept=".zip,.sprite-project.zip,application/zip"
              onChange={(event) => {
                void onImportProjectArchive(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            className="button secondary"
            onClick={() => activeProject && void onExportProjectArchive(activeProject)}
            disabled={!activeProject}
          >
            Archive current project
          </button>
          <button className="button secondary" onClick={() => void onChooseProjectDirectory()}>
            Write project folders
          </button>
        </div>
      </div>
      {missingImageKeys.length > 0 && (
        <div className="missing-images-panel">
          <strong>Missing files ({missingImageKeys.length})</strong>
          {missingImageKeys.map((key) => (
            <label key={key}>
              {key.slice(0, 44)}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  void onRecoverMissingImage(key, event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          ))}
        </div>
      )}
      {foundationNotice && (
        <p className="foundation-notice" role="status">
          {foundationNotice}
        </p>
      )}
    </section>
  );
}
