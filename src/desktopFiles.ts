import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { loadImages } from "./imageStore";
import type { StudioProject } from "./types";

export async function writeDesktopProject(root: string, project: StudioProject, imageBlobs: Record<string, Blob>, anchorBlob?: Blob) {
  const projectRoot = await join(root, project.slug);
  await mkdir(projectRoot, { recursive: true });
  const { anchorPreview: _anchorPreview, ...manifest } = project;
  await writeText(projectRoot, "project.json", JSON.stringify(manifest, null, 2));

  const anchorDirectory = await join(projectRoot, "anchor");
  await mkdir(anchorDirectory, { recursive: true });
  if (project.anchorVersions?.length) {
    const anchorsPath = await join(anchorDirectory, "versions");
    await mkdir(anchorsPath, { recursive: true });
    for (const [index, version] of project.anchorVersions.entries()) {
      const blob = imageBlobs[version.imageKey];
      if (blob) await writeBytes(anchorsPath, `v${String(index + 1).padStart(3, "0")}-${safeFilename(version.name)}.${imageExtension(blob)}`, new Uint8Array(await blob.arrayBuffer()));
    }
  }
  if (anchorBlob) {
    const extension = anchorBlob.type === "image/jpeg" ? "jpg" : anchorBlob.type === "image/webp" ? "webp" : "png";
    await writeBytes(anchorDirectory, `anchor.${extension}`, new Uint8Array(await anchorBlob.arrayBuffer()));
  }
  await writeText(anchorDirectory, "anchor.json", JSON.stringify({ name: project.anchorName }, null, 2));

  for (const card of project.cards) {
    const cardPath = await join(projectRoot, "cards", card.kind === "animation" ? "animations" : "assets", card.slug);
    await mkdir(cardPath, { recursive: true });
    await writeText(cardPath, "card.json", JSON.stringify(card, null, 2));
    if (card.kind === "animation") {
      const versions = card.versions?.length ? card.versions : [{ id: card.activeVersionId ?? "current", number: 1, createdAt: card.createdAt, prompt: card.prompt, phases: card.phases ?? [], frames: card.frames ?? [], fps: card.fps ?? 8, loop: card.loop ?? true, size: card.size ?? project.size, canvasSize: card.canvasSize, anchorVersionId: card.anchorVersionId }];
      for (const version of versions) {
        const versionPath = await join(cardPath, "versions", `v${String(version.number).padStart(3, "0")}`);
        const framesPath = await join(versionPath, "frames");
        await mkdir(framesPath, { recursive: true });
        await writeText(versionPath, "generation.json", JSON.stringify(version, null, 2));
        for (const frame of version.frames) {
          const blob = imageBlobs[frame.imageKey];
          if (blob) await writeBytes(framesPath, `${safeFilename(frame.id)}-${safeFilename(frame.name)}.${imageExtension(blob)}`, new Uint8Array(await blob.arrayBuffer()));
        }
      }
    } else {
      const versions = card.assetVersions?.length ? card.assetVersions : card.generatedImageKey ? [{ id: card.activeAssetVersionId ?? "current", number: 1, imageKey: card.generatedImageKey, prompt: card.prompt, createdAt: card.createdAt }] : [];
      for (const version of versions) {
        const versionPath = await join(cardPath, "versions", `v${String(version.number).padStart(3, "0")}`);
        await mkdir(versionPath, { recursive: true });
        const blob = imageBlobs[version.imageKey];
        if (blob) await writeBytes(versionPath, `asset.${imageExtension(blob)}`, new Uint8Array(await blob.arrayBuffer()));
        await writeText(versionPath, "generation.json", JSON.stringify(version, null, 2));
      }
      if (card.referenceImageKey && imageBlobs[card.referenceImageKey]) await writeBytes(cardPath, `reference.${imageExtension(imageBlobs[card.referenceImageKey])}`, new Uint8Array(await imageBlobs[card.referenceImageKey].arrayBuffer()));
    }
    if (card.startPoseImageKey && imageBlobs[card.startPoseImageKey]) await writeBytes(cardPath, `start-pose.${imageExtension(imageBlobs[card.startPoseImageKey])}`, new Uint8Array(await imageBlobs[card.startPoseImageKey].arrayBuffer()));
  }
}

export async function persistDesktopProjects(projects: StudioProject[]) {
  const root = await join(await appDataDir(), "projects");
  await mkdir(root, { recursive: true });
  for (const project of projects) {
    const keys = [...(project.anchorVersions ?? []).map((version) => version.imageKey), ...project.cards.flatMap((card) => [
      ...(card.frames ?? []).map((frame) => frame.imageKey),
      ...(card.versions ?? []).flatMap((version) => version.frames.map((frame) => frame.imageKey)),
      ...(card.generatedImageKey ? [card.generatedImageKey] : []),
      ...(card.assetVersions ?? []).map((version) => version.imageKey),
      ...(card.startPoseImageKey ? [card.startPoseImageKey] : []),
      ...(card.referenceImageKey ? [card.referenceImageKey] : []),
    ])];
    const images = await loadImages(keys);
    const currentAnchor = project.anchorVersions?.find((version) => version.id === project.anchorVersionId);
    const anchorBlob = currentAnchor ? images[currentAnchor.imageKey] : project.anchorPreview ? await fetch(project.anchorPreview).then((response) => response.blob()) : undefined;
    await writeDesktopProject(root, project, images, anchorBlob);
  }
}

export async function desktopProjectsDirectory() {
  return join(await appDataDir(), "projects");
}

async function writeText(directory: string, filename: string, text: string) {
  const path = await join(directory, filename);
  await writeFile(path, new TextEncoder().encode(text));
}

async function writeBytes(directory: string, filename: string, bytes: Uint8Array) {
  const path = await join(directory, filename);
  await writeFile(path, bytes);
}

function safeFilename(name: string) {
  const leaf = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100);
  return leaf || "frame.png";
}

function imageExtension(blob: Blob) {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  return "png";
}
