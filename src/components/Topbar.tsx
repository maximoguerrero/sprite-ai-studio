import type { AppView } from "./Sidebar";
import type { ImageModelGroup } from "../hooks/useImageModelCatalog";
import { ImageModelPicker } from "./ImageModelPicker";

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
          <ImageModelPicker
            groups={imageModelGroups}
            value={selectedImageModel}
            onChange={onImageModelChange}
            title="Pick the provider and image model used for generation"
          />
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
