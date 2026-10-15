import type { AppView } from "./Sidebar";
import type { ImageModelGroup } from "../hooks/useImageModelCatalog";

type TopbarProps = {
  activeView: AppView;
  projectName?: string;
  providerConfigured: boolean;
  imageModelGroups: ImageModelGroup[];
  selectedImageModel: string;
  onImageModelChange: (value: string) => void;
  onImageModelRefresh: () => void;
  imageModelsLoading: boolean;
};

export function Topbar({
  activeView,
  projectName,
  providerConfigured,
  imageModelGroups,
  selectedImageModel,
  onImageModelChange,
  onImageModelRefresh,
  imageModelsLoading,
}: TopbarProps) {
  const pageName =
    activeView === "skills" ? "Skills library" : activeView === "settings" ? "Settings" : (projectName ?? "Projects");
  const isListed = imageModelGroups.some((group) =>
    group.models.some((model) => `${group.profileId}::${model}` === selectedImageModel)
  );
  return (
    <header className="topbar flex items-center justify-between">
      <div className="breadcrumbs">
        <span>Workspace</span>
        <span className="crumb-slash">/</span>
        <strong>{pageName}</strong>
      </div>
      <div className="topbar-actions">
        <label className="model-picker">
          <span className={`provider-indicator ${providerConfigured ? "configured" : ""}`} />
          <select
            aria-label="Image model used for generation"
            title="Pick the provider and image model used for generation"
            value={selectedImageModel}
            onChange={(event) => onImageModelChange(event.target.value)}
          >
            {selectedImageModel && !isListed ? (
              <option value={selectedImageModel}>{selectedImageModel.split("::")[1] ?? "Image model"}</option>
            ) : null}
            {imageModelGroups.map((group) => (
              <optgroup key={group.profileId} label={group.profileName}>
                {group.models.map((model) => (
                  <option key={`${group.profileId}::${model}`} value={`${group.profileId}::${model}`}>
                    {model}
                  </option>
                ))}
                {group.loading && !group.models.length ? <option value="">Loading models…</option> : null}
                {group.error ? (
                  <option value="" disabled>
                    ⚠ could not list models
                  </option>
                ) : null}
              </optgroup>
            ))}
            {!imageModelGroups.length ? <option value="">No image provider configured</option> : null}
          </select>
          <button
            type="button"
            className="model-refresh"
            aria-label="Reload models from providers"
            title="Reload models from providers"
            onClick={onImageModelRefresh}
            disabled={imageModelsLoading}
          >
            {imageModelsLoading ? "…" : "↻"}
          </button>
        </label>
        <button className="avatar" aria-label="User profile">
          S
        </button>
      </div>
    </header>
  );
}
