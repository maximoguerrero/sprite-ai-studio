import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AnchorVersion,
  AnimationPhase,
  AnimationVersion,
  AssetVersion,
  GenerationJob,
  StudioCard,
  StudioFrame,
  StudioProject,
  VideoVersion,
} from "../types";
import { deleteImages, saveImage } from "../imageStore";
import { referencedImageKeys, unreferencedImageKeys } from "../lib/imageReferences";
import { blobToDataUrl } from "../lib/imageUtils";
import { makeId, makeSlug } from "../lib/ids";
import { normalizeAnimationVersion, normalizeFrameTiming } from "../workspaceMigration";

export function useCardActions({
  setProjects,
  setFoundationNotice,
  setGenerationJobs,
  activeCardId,
  setActiveCardId,
  activeProjectId,
  activeProject,
  projectsRef,
}: {
  setProjects: Dispatch<SetStateAction<StudioProject[]>>;
  setFoundationNotice: (message: string) => void;
  setGenerationJobs: Dispatch<SetStateAction<GenerationJob[]>>;
  activeCardId: string | null;
  setActiveCardId: Dispatch<SetStateAction<string | null>>;
  activeProjectId: string | null;
  activeProject: StudioProject | null;
  projectsRef: MutableRefObject<StudioProject[]>;
}) {
  function updateCard(projectId: string, cardId: string, update: (card: StudioCard) => StudioCard) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? { ...project, cards: project.cards.map((card) => (card.id === cardId ? update(card) : card)) }
          : project
      )
    );
  }

  function renameCard(project: StudioProject, card: StudioCard) {
    const name = window.prompt("Card name", card.name)?.trim();
    if (!name || name === card.name) return;
    applyCardRename(project, card, name);
  }

  function applyCardRename(project: StudioProject, card: StudioCard, name: string) {
    const slug = makeSlug(name, card.id);
    updateCard(project.id, card.id, (current) => ({
      ...current,
      name,
      slug,
      folderPath: `${project.folderPath}/cards/${current.kind === "animation" ? "animations" : "assets"}/${slug}`,
    }));
  }

  function duplicateCard(project: StudioProject, card: StudioCard) {
    const id = makeId();
    const slug = makeSlug(`${card.name} copy`, id);
    const duplicate: StudioCard = {
      ...structuredClone(card),
      id,
      name: `${card.name} copy`,
      slug,
      folderPath: `${project.folderPath}/cards/${card.kind === "animation" ? "animations" : "assets"}/${slug}`,
      createdAt: new Date().toISOString(),
      frames: [],
      versions: [],
      activeVersionId: undefined,
      generatedImageKey: undefined,
      thumbnailFrameId: undefined,
    };
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? { ...item, cards: [duplicate, ...item.cards] } : item))
    );
  }

  function moveCard(project: StudioProject, cardId: string, offset: number) {
    setProjects((current) =>
      current.map((item) => {
        if (item.id !== project.id) return item;
        const index = item.cards.findIndex((card) => card.id === cardId);
        if (index < 0) return item;
        const cardKind = item.cards[index].kind;
        const siblingIndices = item.cards
          .map((card, cardIndex) => (card.kind === cardKind && !card.archivedAt ? cardIndex : -1))
          .filter((cardIndex) => cardIndex >= 0);
        const position = siblingIndices.indexOf(index);
        const targetPosition = Math.max(0, Math.min(siblingIndices.length - 1, position + offset));
        if (position < 0 || targetPosition === position) return item;
        const cards = [...item.cards];
        const targetIndex = siblingIndices[targetPosition];
        [cards[index], cards[targetIndex]] = [cards[targetIndex], cards[index]];
        return { ...item, cards };
      })
    );
  }

  function archiveCard(project: StudioProject, card: StudioCard) {
    updateCard(project.id, card.id, (current) => ({ ...current, archivedAt: new Date().toISOString() }));
  }

  function restoreCard(project: StudioProject, card: StudioCard) {
    updateCard(project.id, card.id, (current) => {
      const { archivedAt: _archivedAt, ...restored } = current;
      return restored;
    });
  }

  async function deleteCard(project: StudioProject, card: StudioCard) {
    if (!window.confirm(`Permanently delete “${card.name}”?`)) return;
    const imageKeys = new Set<string>();
    if (card.generatedImageKey) imageKeys.add(card.generatedImageKey);
    if (card.referenceImageKey) imageKeys.add(card.referenceImageKey);
    for (const frame of card.frames ?? []) {
      imageKeys.add(frame.imageKey);
      if (frame.editImageKey) imageKeys.add(frame.editImageKey);
    }
    for (const version of card.versions ?? [])
      for (const frame of version.frames) {
        imageKeys.add(frame.imageKey);
        if (frame.editImageKey) imageKeys.add(frame.editImageKey);
      }
    for (const version of card.assetVersions ?? []) imageKeys.add(version.imageKey);
    for (const layer of card.assetLayers ?? []) imageKeys.add(layer.imageKey);
    for (const video of card.videoVersions ?? []) imageKeys.add(video.imageKey);
    for (const key of [...imageKeys]) imageKeys.add(`${key}-thumb`);
    const referencedElsewhere = new Set(
      project.cards
        .filter((entry) => entry.id !== card.id)
        .flatMap((entry) =>
          [
            entry.generatedImageKey,
            entry.referenceImageKey,
            ...(entry.frames ?? []).flatMap((frame) =>
              frame.editImageKey ? [frame.imageKey, frame.editImageKey] : [frame.imageKey]
            ),
            ...(entry.versions ?? []).flatMap((version) =>
              version.frames.flatMap((frame) =>
                frame.editImageKey ? [frame.imageKey, frame.editImageKey] : [frame.imageKey]
              )
            ),
            ...(entry.generatedImageKey ? [`${entry.generatedImageKey}-thumb`] : []),
            ...(entry.assetVersions ?? []).map((version) => version.imageKey),
            ...(entry.assetVersions ?? []).map((version) => `${version.imageKey}-thumb`),
            ...(entry.assetLayers ?? []).map((layer) => layer.imageKey),
            ...(entry.assetLayers ?? []).map((layer) => `${layer.imageKey}-thumb`),
            ...(entry.videoVersions ?? []).map((video) => video.imageKey),
          ].filter((key): key is string => Boolean(key))
        )
    );
    try {
      await deleteImages(
        [...imageKeys].filter(
          (key) => !referencedElsewhere.has(key) && !referencedElsewhere.has(key.replace(/-thumb$/, ""))
        )
      );
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not delete the card's stored images.");
      return;
    }
    setProjects((current) =>
      current.map((item) =>
        item.id === project.id ? { ...item, cards: item.cards.filter((entry) => entry.id !== card.id) } : item
      )
    );
    setGenerationJobs((current) => current.filter((job) => job.cardId !== card.id));
    if (activeCardId === card.id) setActiveCardId(null);
    setFoundationNotice(`Deleted “${card.name}” and its stored images.`);
  }

  async function deleteVideoClip(project: StudioProject, card: StudioCard, video: VideoVersion) {
    if (!window.confirm("Delete this video clip? The stored mp4 will also be deleted.")) return;
    try {
      await deleteImages([video.imageKey]);
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not delete the stored video.");
      return;
    }
    setProjects((current) =>
      current.map((item) =>
        item.id !== project.id
          ? item
          : {
              ...item,
              cards: item.cards.map((entry) =>
                entry.id !== card.id
                  ? entry
                  : { ...entry, videoVersions: (entry.videoVersions ?? []).filter((entry2) => entry2.id !== video.id) }
              ),
            }
      )
    );
    setFoundationNotice("Deleted the video clip and its stored mp4.");
  }

  function updateAnchor(file?: File) {
    if (!activeProject || !file) return;
    const imageKey = `anchor-${makeId()}`;
    void saveImage(imageKey, file)
      .then(async () => {
        const preview = await blobToDataUrl(file);
        setProjects((current) =>
          current.map((project) => {
            if (project.id !== activeProject.id) return project;
            const version: AnchorVersion = {
              id: makeId(),
              imageKey,
              name: file.name,
              source: "upload",
              artMode: project.anchorArtMode ?? "pixel",
              direction: project.anchorDirection ?? "front",
              pivot: project.anchorPivot,
              createdAt: new Date().toISOString(),
            };
            return {
              ...project,
              anchorName: version.name,
              anchorVersionId: version.id,
              anchorVersions: [...(project.anchorVersions ?? []), version],
              anchorPreview: preview,
              anchorArtMode: version.artMode,
              anchorDirection: version.direction,
              anchorPivot: version.pivot,
            };
          })
        );
      })
      .catch((error: unknown) =>
        setFoundationNotice(error instanceof Error ? error.message : "Could not save anchor image.")
      );
  }

  function updateAnchorMetadata(
    projectId: string,
    field: "artMode" | "direction" | "pivot",
    value: string | { x: number; y: number }
  ) {
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== projectId) return project;
        const patch =
          field === "artMode"
            ? { anchorArtMode: value as "pixel" | "hd" }
            : field === "direction"
              ? { anchorDirection: value as NonNullable<StudioProject["anchorDirection"]> }
              : { anchorPivot: value as { x: number; y: number } };
        const versions = (project.anchorVersions ?? []).map((version) =>
          version.id !== project.anchorVersionId
            ? version
            : {
                ...version,
                ...(field === "artMode" ? { artMode: value as "pixel" | "hd" } : {}),
                ...(field === "direction" ? { direction: value as NonNullable<AnchorVersion["direction"]> } : {}),
                ...(field === "pivot" ? { pivot: value as { x: number; y: number } } : {}),
              }
        );
        return { ...project, ...patch, anchorVersions: versions };
      })
    );
  }

  function selectAnchorVersion(projectId: string, version: AnchorVersion) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              anchorVersionId: version.id,
              anchorName: version.name,
              anchorPrompt: version.prompt,
              anchorArtMode: version.artMode,
              anchorDirection: version.direction,
              anchorPivot: version.pivot,
              anchorPreview: "",
              cards: project.cards.map((card) =>
                card.anchorVersionId === undefined && !card.generatedImageKey
                  ? { ...card, anchorVersionId: version.id }
                  : card
              ),
            }
          : project
      )
    );
  }

  async function deleteAnchorVersion(project: StudioProject, version: AnchorVersion) {
    const remaining = project.anchorVersions?.filter((item) => item.id !== version.id) ?? [];
    const referenced = project.cards.some(
      (card) =>
        card.anchorVersionId === version.id ||
        card.versions?.some((animationVersion) => animationVersion.anchorVersionId === version.id)
    );
    const referenceNote = referenced
      ? " Cards that already use it will retain their recorded reference."
      : " Its image file will also be deleted.";
    if (!window.confirm(`Delete anchor version “${version.name}”?${referenceNote}`)) return;
    if (!referenced) {
      try {
        await deleteImages([version.imageKey]);
      } catch (error) {
        setFoundationNotice(error instanceof Error ? error.message : "Could not delete the anchor image file.");
        return;
      }
    }
    const nextActive =
      version.id === project.anchorVersionId
        ? remaining.at(-1)
        : remaining.find((item) => item.id === project.anchorVersionId);
    setProjects((current) =>
      current.map((item) =>
        item.id !== project.id
          ? item
          : {
              ...item,
              anchorVersions: remaining,
              anchorVersionId: nextActive?.id,
              anchorName: nextActive?.name ?? "No anchor image yet",
              anchorPrompt: nextActive?.prompt,
              anchorArtMode: nextActive?.artMode ?? item.anchorArtMode,
              anchorDirection: nextActive?.direction ?? item.anchorDirection,
              anchorPivot: nextActive?.pivot ?? item.anchorPivot,
              anchorPreview: "",
            }
      )
    );
    setFoundationNotice(
      referenced
        ? `Removed anchor “${version.name}”. Existing card references are preserved.`
        : `Deleted anchor version “${version.name}”.`
    );
  }

  function selectAnimationVersion(projectId: string, cardId: string, version: AnimationVersion) {
    const safeVersion = normalizeAnimationVersion(
      version as unknown as Record<string, unknown>,
      Math.max(0, version.number - 1),
      undefined
    );
    updateCard(projectId, cardId, (card) => ({
      ...card,
      activeVersionId: safeVersion.id,
      prompt: safeVersion.prompt,
      phases: safeVersion.phases,
      frames: safeVersion.frames,
      fps: safeVersion.fps,
      loop: safeVersion.loop,
      size: safeVersion.size,
      canvasSize: safeVersion.canvasSize,
      anchorVersionId: safeVersion.anchorVersionId,
    }));
  }

  async function deleteAnimationVersion(project: StudioProject, card: StudioCard, version: AnimationVersion) {
    if (!window.confirm(`Delete animation version “v${version.number}”? Its frame images will also be deleted.`))
      return;
    const imageKeys = [
      ...new Set(
        version.frames.flatMap((frame) =>
          frame.editImageKey ? [frame.imageKey, frame.editImageKey] : [frame.imageKey]
        )
      ),
    ];
    const referenced = new Set<string>();
    const collectFrames = (frames: { imageKey: string; editImageKey?: string }[]) => {
      for (const frame of frames) {
        referenced.add(frame.imageKey);
        if (frame.editImageKey) referenced.add(frame.editImageKey);
      }
    };
    for (const other of project.cards) {
      if (other.id === card.id) {
        for (const entry of other.versions ?? []) if (entry.id !== version.id) collectFrames(entry.frames);
      } else {
        for (const entry of other.versions ?? []) collectFrames(entry.frames);
      }
      if (other.id !== card.id || card.activeVersionId !== version.id) collectFrames(other.frames ?? []);
    }
    const deletable = imageKeys.filter((key) => !referenced.has(key));
    if (deletable.length) {
      try {
        await deleteImages(deletable);
      } catch (error) {
        setFoundationNotice(error instanceof Error ? error.message : "Could not delete the version frame images.");
        return;
      }
    }
    const remaining = (card.versions ?? []).filter((entry) => entry.id !== version.id);
    setProjects((current) =>
      current.map((item) =>
        item.id !== project.id
          ? item
          : {
              ...item,
              cards: item.cards.map((entry) => {
                if (entry.id !== card.id) return entry;
                const wasActive = entry.activeVersionId === version.id;
                const nextActive = wasActive
                  ? remaining.at(-1)
                  : remaining.find((candidate) => candidate.id === entry.activeVersionId);
                if (wasActive && nextActive)
                  return {
                    ...entry,
                    versions: remaining,
                    activeVersionId: nextActive.id,
                    prompt: nextActive.prompt,
                    phases: nextActive.phases,
                    frames: nextActive.frames,
                    fps: nextActive.fps,
                    loop: nextActive.loop,
                    size: nextActive.size,
                    canvasSize: nextActive.canvasSize,
                    anchorVersionId: nextActive.anchorVersionId,
                  };
                if (wasActive) return { ...entry, versions: remaining, activeVersionId: undefined, frames: [] };
                return { ...entry, versions: remaining };
              }),
            }
      )
    );
    setFoundationNotice(`Deleted animation version “v${version.number}”.`);
  }

  function updateAnimationVersion(
    projectId: string,
    cardId: string,
    update: (version: AnimationVersion) => AnimationVersion
  ) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    const card = project?.cards.find((item) => item.id === cardId);
    if (!project || !card) return;
    const source = card.versions?.find((version) => version.id === card.activeVersionId);
    const base: AnimationVersion = source ?? {
      id: makeId(),
      number: (card.versions?.length ?? 0) + 1,
      createdAt: new Date().toISOString(),
      prompt: card.prompt,
      phases: card.phases ?? [],
      frames: card.frames ?? [],
      fps: card.fps ?? 8,
      loop: card.loop ?? true,
      size: card.size ?? project.size,
      canvasSize: card.canvasSize,
      anchorVersionId: card.anchorVersionId,
    };
    const updated = update(structuredClone(base));
    const version = source ? updated : base;
    updateCard(projectId, cardId, (current) => ({
      ...current,
      prompt: version.prompt,
      phases: version.phases,
      frames: version.frames,
      fps: version.fps,
      loop: version.loop,
      versions: source
        ? current.versions?.map((entry) => (entry.id === version.id ? version : entry))
        : [...(current.versions ?? []), version],
      activeVersionId: version.id,
    }));
  }

  async function revertFrameEdit(project: StudioProject, card: StudioCard, frame: StudioFrame) {
    if (!frame.editImageKey) return;
    if (!window.confirm(`Revert the touch-up on “${frame.name}”? The edited image will be deleted.`)) return;
    const editKey = frame.editImageKey;
    const referencedElsewhere = referencedImageKeys(projectsRef.current, card.id).has(editKey);
    if (!referencedElsewhere) {
      try {
        await deleteImages([editKey]);
      } catch (error) {
        setFoundationNotice(error instanceof Error ? error.message : "Could not delete the edited frame image.");
        return;
      }
    }
    const clearEdit = (entry: StudioFrame): StudioFrame => {
      if (entry.id !== frame.id || !entry.editImageKey) return entry;
      const { editImageKey: _editImageKey, ...rest } = entry;
      return rest;
    };
    updateCard(project.id, card.id, (current) => ({
      ...current,
      frames: current.frames?.map(clearEdit),
      versions: current.versions?.map((version) => ({ ...version, frames: version.frames.map(clearEdit) })),
    }));
    setFoundationNotice(`Reverted “${frame.name}” to the generated frame image.`);
  }

  function saveCardFrames(cardId: string, frames: StudioFrame[], fps: number, loop: boolean) {
    const safeFps = Number.isFinite(fps) && fps > 0 ? Math.max(1, Math.floor(fps)) : 8;
    const safeFrames = frames.map((frame) => normalizeFrameTiming(frame, safeFps) as StudioFrame);
    setProjects((current) =>
      current.map((project) => ({
        ...project,
        cards: project.cards.map((card) => {
          if (card.id !== cardId) return card;
          const changed =
            JSON.stringify(card.frames ?? []) !== JSON.stringify(safeFrames) ||
            card.fps !== safeFps ||
            card.loop !== loop;
          if (!changed) return card;
          const activeVersionId = card.activeVersionId;
          if (!activeVersionId) return { ...card, frames: safeFrames, fps: safeFps, loop };
          const currentVersion = card.versions?.find((version) => version.id === activeVersionId);
          if (!currentVersion || JSON.stringify(currentVersion.frames) === JSON.stringify(safeFrames))
            return { ...card, frames: safeFrames, fps: safeFps, loop };
          const updatedVersion = { ...structuredClone(currentVersion), frames: safeFrames, fps: safeFps, loop };
          return {
            ...card,
            frames: safeFrames,
            fps: safeFps,
            loop,
            versions: card.versions?.map((version) => (version.id === activeVersionId ? updatedVersion : version)),
          };
        }),
      }))
    );
  }

  function saveCardPromptAndPhases(cardId: string, prompt: string, phases: AnimationPhase[]) {
    if (!activeProjectId) return;
    updateAnimationVersion(activeProjectId, cardId, (version) => ({ ...version, prompt, phases }));
  }

  async function deleteAssetLayer(project: StudioProject, card: StudioCard, layerId: string) {
    const layer = (card.assetLayers ?? []).find((entry) => entry.id === layerId);
    if (!layer) return;
    if (!window.confirm(`Delete layer ${layer.layerIndex} of “${card.name}”?`)) return;
    updateCard(project.id, card.id, (current) => ({
      ...current,
      assetLayers: (current.assetLayers ?? []).filter((entry) => entry.id !== layerId),
    }));
    const referenced = new Set(
      projectsRef.current.flatMap((item) =>
        item.cards
          .flatMap((entry) => [
            entry.generatedImageKey,
            ...(entry.assetVersions ?? []).map((version) => version.imageKey),
            ...(entry.assetLayers ?? [])
              .filter((other) => !(entry.id === card.id && other.id === layerId))
              .map((other) => other.imageKey),
          ])
          .filter((key): key is string => Boolean(key))
      )
    );
    const deletable = [layer.imageKey, `${layer.imageKey}-thumb`].filter(
      (key) => !referenced.has(key) && !referenced.has(key.replace(/-thumb$/, ""))
    );
    if (deletable.length) {
      try {
        await deleteImages(deletable);
      } catch {
        setFoundationNotice("The layer was removed, but its stored image could not be deleted.");
      }
    }
  }

  async function selectAssetVersion(project: StudioProject, card: StudioCard, version: AssetVersion) {
    const staleLayers = card.assetLayers ?? [];
    if (
      staleLayers.length &&
      !window.confirm(
        `Selecting version ${version.number} removes the ${staleLayers.length} generated layer${staleLayers.length > 1 ? "s" : ""} from this asset.`
      )
    )
      return;
    updateCard(project.id, card.id, (current) => ({
      ...current,
      generatedImageKey: version.imageKey,
      activeAssetVersionId: version.id,
      assetPlacement: { scale: 1, offsetX: 0, offsetY: 0 },
      assetCrop: undefined,
      assetLayers: [],
    }));
    if (!staleLayers.length) return;
    const staleKeys = staleLayers.flatMap((layer) => [layer.imageKey, `${layer.imageKey}-thumb`]);
    const deletable = unreferencedImageKeys(projectsRef.current, staleKeys, card.id);
    if (deletable.length) {
      try {
        await deleteImages(deletable);
      } catch {
        setFoundationNotice("The version was selected, but some stored layer images could not be deleted.");
      }
    }
  }

  return {
    updateCard,
    renameCard,
    applyCardRename,
    duplicateCard,
    moveCard,
    archiveCard,
    restoreCard,
    deleteCard,
    deleteVideoClip,
    deleteAssetLayer,
    selectAssetVersion,
    updateAnchor,
    updateAnchorMetadata,
    selectAnchorVersion,
    deleteAnchorVersion,
    selectAnimationVersion,
    deleteAnimationVersion,
    updateAnimationVersion,
    saveCardFrames,
    revertFrameEdit,
    saveCardPromptAndPhases,
  };
}
