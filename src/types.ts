export type SpriteSize = "64" | "128" | "512" | "custom";
export type CanvasSize = { width: number; height: number };

export const WORKSPACE_SCHEMA_VERSION = 1 as const;
export const SKILL_SCHEMA_VERSION = 1 as const;

export type CardKind = "animation" | "asset";

export type StudioFrame = {
  id: string;
  imageKey: string;
  editImageKey?: string;
  name: string;
  offsetX: number;
  offsetY: number;
  scale?: number;
  pivotX: number;
  pivotY: number;
  durationMs: number;
  phaseId?: string;
  phaseIndex?: number;
};

/** Single source of truth for which stored image a frame currently shows. */
export function activeFrameImageKey(frame: Pick<StudioFrame, "imageKey" | "editImageKey">): string {
  return frame.editImageKey ?? frame.imageKey;
}

export type AnimationPhase = {
  id: string;
  label: string;
  prompt: string;
};

export type AnimationVersion = {
  id: string;
  number: number;
  createdAt: string;
  prompt: string;
  phases: AnimationPhase[];
  frames: StudioFrame[];
  fps: number;
  loop: boolean;
  size?: SpriteSize;
  canvasSize?: CanvasSize;
  anchorVersionId?: string;
};

export type AssetVersion = {
  id: string;
  number: number;
  imageKey: string;
  prompt: string;
  createdAt: string;
};

export type AssetLayer = {
  id: string;
  layerIndex: number;
  imageKey: string;
  prompt: string;
  createdAt: string;
};

export type AssetPlacement = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type AssetCrop = { x: number; y: number; width: number; height: number };

export type StudioCard = {
  id: string;
  name: string;
  slug: string;
  folderPath: string;
  kind: CardKind;
  prompt: string;
  archivedAt?: string;
  generatedImageKey?: string;
  createdAt: string;
  size?: SpriteSize;
  canvasSize?: CanvasSize;
  frames?: StudioFrame[];
  thumbnailFrameId?: string;
  frameCount?: number;
  fps?: number;
  loop?: boolean;
  skillSnapshot?: SavedSkill;
  anchorVersionId?: string;
  phases?: AnimationPhase[];
  versions?: AnimationVersion[];
  activeVersionId?: string;
  referenceImageKey?: string;
  useAnchorReference?: boolean;
  artMode?: "pixel" | "hd";
  transparentBackground?: boolean;
  variationCount?: number;
  layerCount?: number;
  assetVersions?: AssetVersion[];
  assetLayers?: AssetLayer[];
  activeAssetVersionId?: string;
  assetPlacement?: AssetPlacement;
  assetCrop?: AssetCrop;
  videoVersions?: VideoVersion[];
  videoDuration?: number;
  videoLoopPreset?: string;
  videoPinLoop?: boolean;
  videoSampleCount?: number;
};

export type VideoVersion = {
  id: string;
  imageKey: string;
  prompt: string;
  model: string;
  duration: number;
  createdAt: string;
};

export type StudioProject = {
  id: string;
  name: string;
  slug: string;
  folderPath: string;
  size: SpriteSize;
  canvasSize?: CanvasSize;
  archivedAt?: string;
  anchorName: string;
  anchorPrompt?: string;
  anchorPreview?: string;
  anchorVersionId?: string;
  anchorVersions?: AnchorVersion[];
  anchorArtMode?: "pixel" | "hd";
  anchorDirection?: "front" | "side-left" | "side-right" | "top-down" | "isometric";
  anchorPivot?: { x: number; y: number };
  cards: StudioCard[];
  skills?: SavedSkill[];
  createdAt: string;
};

export type SavedSkill = {
  schemaVersion: typeof SKILL_SCHEMA_VERSION;
  id: string;
  name: string;
  category: "animation" | "asset" | "character" | "general";
  description?: string;
  promptTemplate: string;
  negativePrompt?: string;
  defaults: {
    size?: SpriteSize;
    pixelArt?: boolean;
    transparentBackground?: boolean;
    frameCount?: number;
    fps?: number;
    loop?: boolean;
  };
  workflowNotes?: string[];
  projectId?: string;
  updatedAt: string;
};

export type GenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceAssetIds: string[];
  referenceImageKey?: string;
  referenceImageKeys?: string[];
  inBetweenFrames?: { beforeFrameId: string; afterFrameId: string };
  frameEdit?: { frameId: string };
  animationStrip?: boolean;
  transparentBackground: boolean;
  pixelArt: boolean;
};

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ProviderProfile = {
  id: string;
  name: string;
  providerType?: "openai-compatible" | "parley" | "grok";
  modelKind?: "image" | "text" | "video";
  baseUrl: string;
  model: string;
  imageModel?: string;
  videoModel?: string;
  quality?: "low" | "medium" | "high" | "auto";
  apiKeyConfigured: boolean;
  enabled?: boolean;
  capabilities?: {
    modelsList: boolean;
    textToImage: boolean;
    imageToImage: boolean;
    transparency: boolean;
  };
  updatedAt: string;
};

export type GenerationJob = {
  id: string;
  projectId: string;
  cardId?: string;
  providerProfileId: string;
  // Overrides the provider profile's default image model for this job only
  // (e.g. picking a specific model in the AI touch-up dialog).
  imageModel?: string;
  anchorVersionId?: string;
  status: GenerationStatus;
  target: "anchor" | "asset" | "animation-frame" | "inbetween-frame" | "frame-edit" | "video-animation";
  video?: { model: string; duration: number; resolution?: string; lastFrameImageKey?: string };
  frameIndex?: number;
  phaseId?: string;
  batchId?: string;
  versionId?: string;
  request: GenerationRequest;
  progress: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  outputImageKey?: string;
  variationIndex?: number;
  layerIndex?: number;
  skillSnapshot?: SavedSkill;
};

export type NeutralAtlas = {
  schema: "sprite-studio-atlas/v1";
  meta: { app: "Sprite Studio"; format: "RGBA8888"; size: { width: number; height: number }; scale: 1 };
  project?: { id: string; name: string };
  sheet?: { file: string; layout: string; padding: number };
  animations: Array<{
    id: string;
    name: string;
    cardVersionId?: string;
    anchorVersionId?: string;
    fps: number;
    loop: boolean;
    frameWidth: number;
    frameHeight: number;
    layout?: string;
    padding?: number;
    frames: AtlasFrame[];
  }>;
};

export type AnchorVersion = {
  id: string;
  imageKey: string;
  name: string;
  source: "upload" | "generated";
  prompt?: string;
  artMode?: "pixel" | "hd";
  direction?: "front" | "side-left" | "side-right" | "top-down" | "isometric";
  pivot?: { x: number; y: number };
  createdAt: string;
};

export type AtlasFrame = {
  filename: string;
  frame: { x: number; y: number; w: number; h: number };
  duration: number;
  pivot: { x: number; y: number };
};

export type WorkspaceExport = {
  format: "sprite-studio-workspace/v1";
  exportedAt: string;
  projects: StudioProject[];
  skills: SavedSkill[];
  images: Record<string, { type: string; data: string }>;
  generationJobs?: GenerationJob[];
};

export type ProviderSettings = {
  profiles: ProviderProfile[];
  activeProfileId: string | null;
};

export function parseCanvasSize(value: unknown): CanvasSize | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CanvasSize>;
  if (!Number.isInteger(candidate.width) || !Number.isInteger(candidate.height)) return null;
  if (candidate.width! < 1 || candidate.height! < 1 || candidate.width! > 4096 || candidate.height! > 4096) return null;
  return { width: candidate.width!, height: candidate.height! };
}

export function isWorkspaceExport(value: unknown): value is WorkspaceExport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceExport>;
  return (
    candidate.format === "sprite-studio-workspace/v1" &&
    Array.isArray(candidate.projects) &&
    Array.isArray(candidate.skills) &&
    Boolean(candidate.images && typeof candidate.images === "object")
  );
}
