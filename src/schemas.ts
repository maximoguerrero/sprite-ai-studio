import { z } from "zod";

const canvasSizeSchema = z.object({ width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096) });
const spriteSizeSchema = z.enum(["64", "128", "512", "custom"]);
const assetVersionSchema = z.object({ id: z.string().min(1), number: z.number().int().positive(), imageKey: z.string().min(1), prompt: z.string(), createdAt: z.string() });

export const providerProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  providerType: z.enum(["openai-compatible", "parley", "grok"]).optional(),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  apiKeyConfigured: z.boolean(),
  capabilities: z.object({ modelsList: z.boolean(), textToImage: z.boolean(), imageToImage: z.boolean(), transparency: z.boolean() }).optional(),
  updatedAt: z.string(),
});

export const providerSettingsSchema = z.object({ profiles: z.array(providerProfileSchema), activeProfileId: z.string().nullable() });

export const frameSchema = z.object({
  id: z.string().min(1), imageKey: z.string().min(1), name: z.string().min(1),
  offsetX: z.number().finite(), offsetY: z.number().finite(), pivotX: z.number().finite(), pivotY: z.number().finite(), durationMs: z.number().int().positive(), phaseId: z.string().optional(), phaseIndex: z.number().int().nonnegative().optional(),
});

export const animationPhaseSchema = z.object({ id: z.string().min(1), label: z.string(), prompt: z.string() });
export const animationVersionSchema = z.object({ id: z.string(), number: z.number().int().positive(), createdAt: z.string(), prompt: z.string(), phases: z.array(animationPhaseSchema), frames: z.array(frameSchema), fps: z.number().int().positive(), loop: z.boolean(), size: spriteSizeSchema.optional(), canvasSize: canvasSizeSchema.optional(), anchorVersionId: z.string().optional() });

export const savedSkillSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1),
  category: z.enum(["animation", "asset", "character", "general"]), description: z.string().optional(),
  promptTemplate: z.string(), negativePrompt: z.string().optional(),
  defaults: z.object({ size: spriteSizeSchema.optional(), pixelArt: z.boolean().optional(), transparentBackground: z.boolean().optional(), frameCount: z.number().int().positive().optional(), fps: z.number().int().positive().optional(), loop: z.boolean().optional() }),
  workflowNotes: z.array(z.string()).optional(), projectId: z.string().optional(), updatedAt: z.string(),
});

export const studioCardSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), slug: z.string().min(1), folderPath: z.string().min(1),
  kind: z.enum(["animation", "asset"]), prompt: z.string(), archivedAt: z.string().optional(), generatedImageKey: z.string().optional(), startPoseImageKey: z.string().optional(), createdAt: z.string(), size: spriteSizeSchema.optional(), canvasSize: canvasSizeSchema.optional(),
  frames: z.array(frameSchema).optional(), frameCount: z.number().int().positive().optional(), fps: z.number().int().positive().optional(), loop: z.boolean().optional(),
  skillSnapshot: savedSkillSchema.optional(),
  anchorVersionId: z.string().optional(),
  phases: z.array(animationPhaseSchema).optional(), versions: z.array(animationVersionSchema).optional(), activeVersionId: z.string().optional(),
  referenceImageKey: z.string().optional(), artMode: z.enum(["pixel", "hd"]).optional(), transparentBackground: z.boolean().optional(), variationCount: z.number().int().min(1).max(8).optional(), assetVersions: z.array(assetVersionSchema).optional(), activeAssetVersionId: z.string().optional(), assetPlacement: z.object({ scale: z.number().finite().min(0.1).max(8), offsetX: z.number().finite(), offsetY: z.number().finite() }).optional(), assetCrop: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
});

export const studioProjectSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), slug: z.string().min(1), folderPath: z.string().min(1),
  size: spriteSizeSchema, canvasSize: canvasSizeSchema.optional(), archivedAt: z.string().optional(),
  anchorName: z.string(), anchorPrompt: z.string().optional(), anchorPreview: z.string().optional(),
  anchorVersionId: z.string().optional(),
  anchorVersions: z.array(z.object({ id: z.string(), imageKey: z.string(), name: z.string(), source: z.enum(["upload", "generated"]), prompt: z.string().optional(), artMode: z.enum(["pixel", "hd"]).optional(), direction: z.enum(["front", "side-left", "side-right", "top-down", "isometric"]).optional(), pivot: z.object({ x: z.number(), y: z.number() }).optional(), createdAt: z.string() })).optional(),
  anchorArtMode: z.enum(["pixel", "hd"]).optional(), anchorDirection: z.enum(["front", "side-left", "side-right", "top-down", "isometric"]).optional(), anchorPivot: z.object({ x: z.number(), y: z.number() }).optional(),
  cards: z.array(studioCardSchema), skills: z.array(savedSkillSchema).optional(), createdAt: z.string(),
}).superRefine((project, context) => {
  if (project.size === "custom" && !project.canvasSize) context.addIssue({ code: "custom", message: "Custom projects require canvas dimensions.", path: ["canvasSize"] });
});

export const generationRequestSchema = z.object({
  prompt: z.string().min(1), negativePrompt: z.string().optional(), width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
  referenceAssetIds: z.array(z.string()), referenceImageKey: z.string().optional(), transparentBackground: z.boolean(), pixelArt: z.boolean(),
});

export const generationJobSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), cardId: z.string().optional(), status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  providerProfileId: z.string().min(1), anchorVersionId: z.string().optional(), target: z.enum(["anchor", "asset", "animation-frame"]), frameIndex: z.number().int().nonnegative().optional(), phaseId: z.string().optional(), batchId: z.string().optional(), versionId: z.string().optional(), variationIndex: z.number().int().nonnegative().optional(), skillSnapshot: savedSkillSchema.optional(), request: generationRequestSchema, progress: z.number().min(0).max(100), outputImageKey: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), error: z.string().optional(),
});

export const atlasFrameSchema = z.object({ filename: z.string(), frame: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive() }), duration: z.number().positive(), pivot: z.object({ x: z.number(), y: z.number() }) });
export const neutralAtlasSchema = z.object({ schema: z.literal("sprite-studio-atlas/v1"), meta: z.object({ app: z.literal("Sprite Studio"), format: z.literal("RGBA8888"), size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }), scale: z.literal(1) }), project: z.object({ id: z.string(), name: z.string() }).optional(), sheet: z.object({ file: z.string(), layout: z.string(), padding: z.number().int().nonnegative() }).optional(), animations: z.array(z.object({ id: z.string(), name: z.string(), cardVersionId: z.string().optional(), anchorVersionId: z.string().optional(), fps: z.number().positive(), loop: z.boolean(), frameWidth: z.number().int().positive(), frameHeight: z.number().int().positive(), layout: z.string().optional(), padding: z.number().int().nonnegative().optional(), frames: z.array(atlasFrameSchema) })) });

export const workspaceExportSchema = z.object({
  format: z.literal("sprite-studio-workspace/v1"), exportedAt: z.string(), projects: z.array(studioProjectSchema), skills: z.array(savedSkillSchema),
  images: z.record(z.string(), z.object({ type: z.string(), data: z.string() })),
  generationJobs: z.array(generationJobSchema).optional(),
});
