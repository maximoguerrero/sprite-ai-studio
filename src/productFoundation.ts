import { activeFrameImageKey, type SavedSkill, type StudioCard, type StudioProject } from "./types";

export function isStudioProject(value: unknown): value is StudioProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<StudioProject>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.slug === "string" &&
    typeof project.folderPath === "string" &&
    ["64", "128", "512", "custom"].includes(project.size ?? "") &&
    Array.isArray(project.cards)
  );
}

export function isStudioCard(value: unknown): value is StudioCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<StudioCard>;
  return (
    typeof card.id === "string" &&
    typeof card.name === "string" &&
    typeof card.slug === "string" &&
    typeof card.folderPath === "string" &&
    (card.kind === "animation" || card.kind === "asset") &&
    typeof card.prompt === "string"
  );
}

export function isSavedSkill(value: unknown): value is SavedSkill {
  if (!value || typeof value !== "object") return false;
  const skill = value as Partial<SavedSkill>;
  return (
    skill.schemaVersion === 1 &&
    typeof skill.id === "string" &&
    typeof skill.name === "string" &&
    typeof skill.promptTemplate === "string" &&
    Boolean(skill.defaults && typeof skill.defaults === "object")
  );
}

export function parseStudioProject(value: unknown): StudioProject | null {
  if (!value || typeof value !== "object") return null;
  const project = value as Record<string, unknown>;
  if (
    typeof project.id !== "string" ||
    typeof project.name !== "string" ||
    !["64", "128", "512", "custom"].includes(String(project.size))
  )
    return null;
  if (!Array.isArray(project.cards) || !project.cards.every(isStudioCard)) return null;
  if (project.size === "custom") {
    const dimensions = project.canvasSize as StudioCard["canvasSize"];
    if (
      !dimensions ||
      !Number.isInteger(dimensions.width) ||
      !Number.isInteger(dimensions.height) ||
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > 4096 ||
      dimensions.height > 4096
    )
      return null;
  }
  return project as unknown as StudioProject;
}

export function normalizedCanvas(
  size: StudioProject["size"],
  override?: StudioCard["canvasSize"]
): { width: number; height: number } {
  if (override && Number.isInteger(override.width) && Number.isInteger(override.height)) return override;
  const dimension = size === "custom" ? 64 : Number(size);
  return { width: dimension, height: dimension };
}

export function resolveCardCanvas(project: StudioProject, card: StudioCard) {
  const size = card.size ?? project.size;
  const override = card.canvasSize ?? (size === "custom" ? project.canvasSize : undefined);
  return normalizedCanvas(size, override);
}

export interface WritableFileHandle {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
}

export interface WritableDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WritableDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<{ createWritable(): Promise<WritableFileHandle> }>;
}

export async function writeFile(directory: WritableDirectoryHandle, filename: string, data: Blob | string) {
  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function writeDirectory(
  directory: WritableDirectoryHandle,
  project: StudioProject,
  imageBlobs: Record<string, Blob>,
  anchorBlob?: Blob
) {
  const { anchorPreview: _anchorPreview, ...projectManifest } = project;
  await writeFile(directory, "project.json", JSON.stringify(projectManifest, null, 2));
  const cardsRoot = await directory.getDirectoryHandle("cards", { create: true });
  const anchor = await directory.getDirectoryHandle("anchor", { create: true });
  const anchorVersions = await anchor.getDirectoryHandle("versions", { create: true });
  for (const [index, version] of (project.anchorVersions ?? []).entries()) {
    const blob = imageBlobs[version.imageKey];
    if (blob) await writeFile(anchorVersions, `v${String(index + 1).padStart(3, "0")}-${safeLeaf(version.name)}`, blob);
  }
  if (anchorBlob) {
    const extension = anchorBlob.type === "image/jpeg" ? "jpg" : anchorBlob.type === "image/webp" ? "webp" : "png";
    await writeFile(anchor, `anchor.${extension}`, anchorBlob);
  }
  await writeFile(
    anchor,
    "anchor.json",
    JSON.stringify(
      {
        name: project.anchorName,
        file: anchorBlob
          ? `anchor.${anchorBlob.type === "image/jpeg" ? "jpg" : anchorBlob.type === "image/webp" ? "webp" : "png"}`
          : null,
      },
      null,
      2
    )
  );
  const animations = await cardsRoot.getDirectoryHandle("animations", { create: true });
  const assets = await cardsRoot.getDirectoryHandle("assets", { create: true });
  for (const card of project.cards) {
    const parent = card.kind === "animation" ? animations : assets;
    const cardDirectory = await parent.getDirectoryHandle(card.slug, { create: true });
    await writeFile(cardDirectory, "card.json", JSON.stringify(card, null, 2));
    const versions = await cardDirectory.getDirectoryHandle("versions", { create: true });
    const activeVersion = await versions.getDirectoryHandle("v001", { create: true });
    const framesDirectory = await activeVersion.getDirectoryHandle("frames", { create: true });
    if (card.generatedImageKey && imageBlobs[card.generatedImageKey]) {
      await writeFile(activeVersion, "asset.png", imageBlobs[card.generatedImageKey]);
    }
    for (const frame of card.frames ?? []) {
      const blob = imageBlobs[activeFrameImageKey(frame)];
      if (blob) await writeFile(framesDirectory, `${frame.id}-${safeLeaf(frame.name)}`, blob);
    }
    await writeFile(
      activeVersion,
      "generation.json",
      JSON.stringify(
        {
          prompt: card.prompt,
          frameCount: card.frames?.length ?? 0,
          fps: card.fps ?? 8,
          loop: card.loop ?? true,
          canvas: resolveCardCanvas(project, card),
        },
        null,
        2
      )
    );
  }
}

function safeLeaf(name: string) {
  const safe = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80);
  return safe || "frame.png";
}
