import type { StudioProject } from "../types";

export function referencedImageKeys(projects: StudioProject[], exceptCardId?: string): Set<string> {
  const keys = new Set<string>();
  for (const project of projects)
    for (const card of project.cards) {
      for (const version of card.assetVersions ?? []) {
        keys.add(version.imageKey);
        keys.add(`${version.imageKey}-thumb`);
      }
      if (card.id === exceptCardId) continue;
      if (card.generatedImageKey) keys.add(card.generatedImageKey);
      if (card.referenceImageKey) keys.add(card.referenceImageKey);
      for (const frame of card.frames ?? []) {
        keys.add(frame.imageKey);
        if (frame.editImageKey) keys.add(frame.editImageKey);
      }
      for (const version of card.versions ?? [])
        for (const frame of version.frames) {
          keys.add(frame.imageKey);
          if (frame.editImageKey) keys.add(frame.editImageKey);
        }
      for (const layer of card.assetLayers ?? []) {
        keys.add(layer.imageKey);
        keys.add(`${layer.imageKey}-thumb`);
      }
      for (const video of card.videoVersions ?? []) keys.add(video.imageKey);
    }
  return keys;
}

export function unreferencedImageKeys(projects: StudioProject[], keys: string[], exceptCardId?: string): string[] {
  const referenced = referencedImageKeys(projects, exceptCardId);
  return keys.filter((key) => !referenced.has(key) && !referenced.has(key.replace(/-thumb$/, "")));
}
