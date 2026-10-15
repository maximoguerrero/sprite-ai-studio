import type { AnchorVersion, SavedSkill, StudioCard, StudioFrame, StudioProject } from "../types";
import { normalizeAnimationVersion, normalizeFrameTiming } from "../workspaceMigration";
import { makeSlug } from "./ids";

export function hydrateProjects(value: unknown): StudioProject[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && "id" in entry))
    .map((rawProject) => {
      const project = rawProject as unknown as StudioProject;
      const projectSlug =
        typeof rawProject.slug === "string"
          ? rawProject.slug
          : makeSlug(String(rawProject.name ?? "project"), String(rawProject.id));
      return {
        ...project,
        slug: projectSlug,
        folderPath: typeof rawProject.folderPath === "string" ? rawProject.folderPath : `projects/${projectSlug}`,
        canvasSize:
          rawProject.size === "custom"
            ? {
                width: Number((rawProject.canvasSize as { width?: unknown } | undefined)?.width) || 64,
                height: Number((rawProject.canvasSize as { height?: unknown } | undefined)?.height) || 64,
              }
            : undefined,
        anchorVersions: Array.isArray(rawProject.anchorVersions) ? (rawProject.anchorVersions as AnchorVersion[]) : [],
        anchorArtMode: rawProject.anchorArtMode === "hd" ? "hd" : "pixel",
        anchorDirection:
          typeof rawProject.anchorDirection === "string"
            ? (rawProject.anchorDirection as StudioProject["anchorDirection"])
            : "front",
        anchorPivot:
          rawProject.anchorPivot && typeof rawProject.anchorPivot === "object"
            ? (rawProject.anchorPivot as { x: number; y: number })
            : undefined,
        cards: Array.isArray(rawProject.cards)
          ? (rawProject.cards as Record<string, unknown>[]).map((rawCard) => {
              const card = rawCard as unknown as StudioCard;
              const cardSlug =
                typeof rawCard.slug === "string"
                  ? rawCard.slug
                  : makeSlug(String(rawCard.name ?? "card"), String(rawCard.id));
              const kind = rawCard.kind === "asset" ? "assets" : "animations";
              const normalizedAssetVersions = Array.isArray(rawCard.assetVersions)
                ? ((rawCard.assetVersions as Array<Record<string, unknown>>).map((version, index) => ({
                    ...version,
                    number: Number(version.number) > 0 ? Math.floor(Number(version.number)) : index + 1,
                  })) as unknown as StudioCard["assetVersions"])
                : undefined;
              const normalizedVersions = Array.isArray(rawCard.versions)
                ? (rawCard.versions as Array<Record<string, unknown>>).map((version, index) =>
                    normalizeAnimationVersion(version, index, rawCard.fps)
                  )
                : undefined;
              const normalizedCardFrames = Array.isArray(rawCard.frames)
                ? rawCard.frames.map((frame) => normalizeFrameTiming(frame, rawCard.fps) as StudioFrame)
                : card.frames;
              return {
                ...card,
                slug: cardSlug,
                folderPath:
                  typeof rawCard.folderPath === "string"
                    ? rawCard.folderPath
                    : `projects/${projectSlug}/cards/${kind}/${cardSlug}`,
                frameCount: Number(rawCard.frameCount) > 0 ? Math.floor(Number(rawCard.frameCount)) : undefined,
                fps: Number(rawCard.fps) > 0 ? Math.floor(Number(rawCard.fps)) : undefined,
                frames: normalizedCardFrames,
                versions: normalizedVersions,
                assetVersions: normalizedAssetVersions,
                ...(rawCard.size === "custom" && !rawCard.canvasSize ? { canvasSize: { width: 64, height: 64 } } : {}),
              };
            })
          : [],
        skills: Array.isArray(rawProject.skills) ? (rawProject.skills as SavedSkill[]) : [],
      };
    });
}
