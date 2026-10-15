import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  AnchorVersion,
  AssetLayer,
  AssetVersion,
  CanvasSize,
  GenerationJob,
  ProviderProfile,
  StudioFrame,
  StudioProject,
  VideoVersion,
} from "../types";
import { deleteImages, loadImage, saveImage } from "../imageStore";
import { unreferencedImageKeys } from "../lib/imageReferences";
import { generationJobLabel } from "../lib/jobLabels";
import { generateImage } from "../openAIProvider";
import { downloadVideoBlob, submitVideoGeneration, waitForVideo } from "../videoProvider";
import {
  blobToDataUrl,
  convertImageToPng,
  createFlatThumbnail,
  flattenImageOnColor,
  normalizeGeneratedImage,
  splitAnimationStrip,
} from "../lib/imageUtils";
import { makeId } from "../lib/ids";

export function useGenerationJobs({
  providerProfiles,
  projects,
  setProjects,
  setFoundationNotice,
  setIsGeneratingAnchor,
  setGeneratingCardId,
}: {
  providerProfiles: ProviderProfile[];
  projects: StudioProject[];
  setProjects: Dispatch<SetStateAction<StudioProject[]>>;
  setFoundationNotice: (message: string) => void;
  setIsGeneratingAnchor: (value: boolean) => void;
  setGeneratingCardId: (value: string | null) => void;
}) {
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const generationControllers = useRef(new Map<string, AbortController>());
  const cancelledGenerationIds = useRef(new Set<string>());
  const generationQueueRef = useRef(Promise.resolve());
  // Jobs run long after they were enqueued, so reads of the workspace must come from the
  // latest render rather than the projects array captured when the job was created.
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  function makeGenerationJob(args: {
    project: StudioProject;
    provider: ProviderProfile;
    card?: StudioProject["cards"][number];
    prompt: string;
    dimensions: CanvasSize;
    target: "anchor" | "asset" | "animation-frame" | "inbetween-frame" | "frame-edit" | "video-animation";
    referenceImageKey?: string;
    anchorVersionId?: string;
    frameIndex?: number;
    phaseId?: string;
    batchId?: string;
    versionId?: string;
    variationIndex?: number;
    layerIndex?: number;
  }): GenerationJob {
    const now = new Date().toISOString();
    return {
      id: args.batchId
        ? `${args.batchId}-${String(args.frameIndex ?? args.variationIndex ?? 0).padStart(3, "0")}${args.layerIndex ? `-${String(args.layerIndex).padStart(2, "0")}` : ""}`
        : makeId(),
      projectId: args.project.id,
      cardId: args.card?.id,
      providerProfileId: args.provider.id,
      anchorVersionId: args.anchorVersionId,
      frameIndex: args.frameIndex,
      phaseId: args.phaseId,
      batchId: args.batchId,
      versionId: args.versionId,
      variationIndex: args.variationIndex,
      layerIndex: args.layerIndex,
      skillSnapshot: args.card?.skillSnapshot ? structuredClone(args.card.skillSnapshot) : undefined,
      target: args.target,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      request: {
        prompt: args.prompt,
        width: args.dimensions.width,
        height: args.dimensions.height,
        referenceAssetIds: [],
        referenceImageKey: args.referenceImageKey,
        animationStrip: args.target === "animation-frame",
        transparentBackground:
          args.target === "asset"
            ? (args.card?.transparentBackground ?? true)
            : args.target === "inbetween-frame" || args.target === "frame-edit"
              ? true
              : false,
        pixelArt: args.card?.kind === "asset" ? args.card.artMode !== "hd" : true,
      },
    };
  }

  async function enqueueGeneration(job: GenerationJob) {
    setGenerationJobs((current) => [job, ...current]);
    generationQueueRef.current = generationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (cancelledGenerationIds.current.has(job.id)) return;
        await runGeneration(job);
      });
    await generationQueueRef.current;
  }

  async function runGeneration(original: GenerationJob): Promise<boolean> {
    const controller = new AbortController();
    generationControllers.current.set(original.id, controller);
    const provider = providerProfiles.find((profile) => profile.id === original.providerProfileId);
    const currentProjects = projectsRef.current;
    const project = currentProjects.find((item) => item.id === original.projectId);
    if (!provider || !project) {
      setGenerationJobs((current) =>
        current.map((item) =>
          item.id === original.id
            ? {
                ...item,
                status: "failed",
                error: "Provider profile or project is unavailable.",
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
      generationControllers.current.delete(original.id);
      setFoundationNotice(
        `${generationJobLabel(original)} failed: ${provider ? "the project is unavailable" : "the provider profile is unavailable"}.`
      );
      return false;
    }
    const job = {
      ...original,
      status: "running" as const,
      progress: 10,
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
    setGenerationJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
    if (job.target === "anchor") setIsGeneratingAnchor(true);
    if (job.cardId) setGeneratingCardId(job.cardId);
    try {
      if (job.target === "video-animation") {
        const video = job.video;
        if (!video) throw new Error("This video job is missing its video settings.");
        const videoReferenceKey = job.request.referenceImageKey;
        const videoReferenceBlob = videoReferenceKey ? await loadImage(videoReferenceKey) : undefined;
        if (videoReferenceKey && !videoReferenceBlob)
          throw new Error("The anchor image for this video job is missing from local storage.");
        const lastFrameBlob = video.lastFrameImageKey ? await loadImage(video.lastFrameImageKey) : undefined;
        if (video.lastFrameImageKey && !lastFrameBlob)
          throw new Error("The pinned last-frame image for this video job is missing from local storage.");
        const requestId = await submitVideoGeneration(provider, {
          model: video.model,
          prompt: job.request.prompt,
          duration: video.duration,
          resolution: video.resolution,
          imageDataUrl: videoReferenceBlob
            ? await blobToDataUrl(await flattenImageOnColor(videoReferenceBlob, "#00ff00"))
            : undefined,
          lastFrameDataUrl: lastFrameBlob
            ? await blobToDataUrl(await flattenImageOnColor(lastFrameBlob, "#00ff00"))
            : undefined,
        });
        setGenerationJobs((current) =>
          current.map((item) =>
            item.id === job.id ? { ...job, progress: 15, updatedAt: new Date().toISOString() } : item
          )
        );
        const videoUrl = await waitForVideo(provider, requestId, {
          signal: controller.signal,
          onProgress: (progress) =>
            setGenerationJobs((current) =>
              current.map((item) =>
                item.id === job.id
                  ? {
                      ...job,
                      progress: 15 + Math.round(Math.min(100, Math.max(0, progress)) * 0.6),
                      updatedAt: new Date().toISOString(),
                    }
                  : item
              )
            ),
        });
        setGenerationJobs((current) =>
          current.map((item) =>
            item.id === job.id ? { ...job, progress: 78, updatedAt: new Date().toISOString() } : item
          )
        );
        const blob = await downloadVideoBlob(provider, videoUrl);
        const videoKey = `video-${job.id}`;
        await saveImage(videoKey, blob);
        const record: VideoVersion = {
          id: makeId(),
          imageKey: videoKey,
          prompt: job.request.prompt,
          model: video.model,
          duration: video.duration,
          createdAt: new Date().toISOString(),
        };
        setProjects((current) =>
          current.map((item) =>
            item.id !== job.projectId
              ? item
              : {
                  ...item,
                  cards: item.cards.map((card) =>
                    card.id === job.cardId ? { ...card, videoVersions: [...(card.videoVersions ?? []), record] } : card
                  ),
                }
          )
        );
        setGenerationJobs((current) =>
          current.map((item) =>
            item.id === job.id
              ? {
                  ...job,
                  status: "succeeded",
                  progress: 100,
                  outputImageKey: videoKey,
                  updatedAt: new Date().toISOString(),
                }
              : item
          )
        );
        setFoundationNotice(
          `Video clip generated (${(blob.size / 1048576).toFixed(1)} MB). Open the card to extract frames.`
        );
        return true;
      }
      const reference = job.request.referenceImageKey ? await loadImage(job.request.referenceImageKey) : undefined;
      const references = await Promise.all(
        (job.request.referenceImageKeys ?? []).map(async (imageKey) => {
          const image = await loadImage(imageKey);
          return image && (job.target === "inbetween-frame" || job.target === "frame-edit")
            ? convertImageToPng(image)
            : image;
        })
      );
      if (job.request.referenceImageKey && !reference)
        throw new Error("A required anchor image is missing from local storage.");
      if (references.some((image) => !image))
        throw new Error("A required timeline reference frame is missing from local storage.");
      if ((reference || references.length) && provider.capabilities?.imageToImage === false)
        throw new Error(
          "This provider is configured for text-to-image only. Enable image edits in provider settings or choose a reference-capable provider."
        );
      setGenerationJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...job, progress: 35, updatedAt: new Date().toISOString() } : item
        )
      );
      const result = await withTimeout(
        generateImage(provider, {
          prompt: job.request.prompt,
          width: job.request.width,
          height: job.request.height,
          transparentBackground: job.request.transparentBackground,
          quality: provider.quality ?? "auto",
          referenceImage: reference,
          referenceImages: references.filter((image): image is Blob => Boolean(image)),
          signal: controller.signal,
        }),
        controller,
        180_000
      );
      setGenerationJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...job, progress: 82, updatedAt: new Date().toISOString() } : item
        )
      );
      const outputImageKey = `generated-${job.id}`;
      if (job.request.animationStrip) {
        const frames = await splitAnimationStrip(result.blob);
        const frameRecords = await Promise.all(
          frames.map(async (frameBlob, frameIndex): Promise<StudioFrame> => {
            const imageKey = `${outputImageKey}-frame-${String(frameIndex + 1).padStart(2, "0")}`;
            await saveImage(imageKey, frameBlob);
            const phase = job.cardId
              ? currentProjects.find((item) => item.id === job.projectId)?.cards.find((card) => card.id === job.cardId)
                  ?.phases?.[frameIndex]
              : undefined;
            return {
              id: makeId(),
              imageKey,
              name: phase?.label || `Frame ${String(frameIndex + 1).padStart(2, "0")}`,
              phaseId: phase?.id,
              phaseIndex: frameIndex,
              offsetX: 0,
              offsetY: 0,
              pivotX: 128,
              pivotY: 230,
              durationMs: Math.round(1000 / 8),
            };
          })
        );
        setProjects((current) =>
          current.map((item) =>
            item.id !== job.projectId
              ? item
              : {
                  ...item,
                  cards: item.cards.map((card) => {
                    if (card.id !== job.cardId) return card;
                    const versions = (card.versions ?? []).map((version) =>
                      version.id === job.versionId
                        ? {
                            ...version,
                            frames: frameRecords,
                            fps: card.fps ?? 8,
                            loop: card.loop ?? true,
                            size: "custom" as const,
                            canvasSize: { width: 256, height: 256 },
                          }
                        : version
                    );
                    const activeFrames = job.versionId === card.activeVersionId ? frameRecords : card.frames;
                    return {
                      ...card,
                      frames: activeFrames,
                      frameCount: 8,
                      size: "custom",
                      canvasSize: { width: 256, height: 256 },
                      versions,
                      anchorVersionId: job.anchorVersionId ?? card.anchorVersionId,
                    };
                  }),
                }
          )
        );
        setGenerationJobs((current) =>
          current.map((item) =>
            item.id === job.id
              ? {
                  ...job,
                  status: "succeeded",
                  progress: 100,
                  outputImageKey: `${outputImageKey}-frame-01`,
                  updatedAt: new Date().toISOString(),
                }
              : item
          )
        );
        setFoundationNotice("Animation sheet generated and split into 8 editable 256 × 256 frames.");
        return true;
      }
      const blob = await normalizeGeneratedImage(result.blob, job.request.width, job.request.height);
      await saveImage(outputImageKey, blob);
      if (job.target === "asset") {
        const sources: Blob[] = [blob];
        if (job.layerIndex) {
          const card = currentProjects
            .find((item) => item.id === job.projectId)
            ?.cards.find((entry) => entry.id === job.cardId);
          const previousLayers = (card?.assetLayers ?? [])
            .filter((entry) => entry.layerIndex !== job.layerIndex)
            .sort((left, right) => left.layerIndex - right.layerIndex);
          const layerBlobs = await Promise.all(previousLayers.map((entry) => loadImage(entry.imageKey)));
          sources.unshift(...layerBlobs.filter((image): image is Blob => Boolean(image)));
        }
        await saveImage(`${outputImageKey}-thumb`, await createFlatThumbnail(sources));
        if (!job.layerIndex) {
          const staleLayers =
            currentProjects.find((item) => item.id === job.projectId)?.cards.find((entry) => entry.id === job.cardId)
              ?.assetLayers ?? [];
          if (staleLayers.length) {
            const deletable = unreferencedImageKeys(
              currentProjects,
              staleLayers.flatMap((layer) => [layer.imageKey, `${layer.imageKey}-thumb`]),
              job.cardId
            );
            if (deletable.length) await deleteImages(deletable).catch(() => undefined);
          }
        }
      }
      if (job.target === "inbetween-frame") {
        const frame: StudioFrame = {
          id: makeId(),
          imageKey: outputImageKey,
          name: "AI in-between",
          offsetX: 0,
          offsetY: 0,
          pivotX: job.request.width / 2,
          pivotY: job.request.height * 0.9,
          durationMs: Math.round(
            1000 /
              Math.max(
                1,
                job.cardId
                  ? (currentProjects
                      .find((item) => item.id === job.projectId)
                      ?.cards.find((item) => item.id === job.cardId)?.fps ?? 8)
                  : 8
              )
          ),
        };
        setProjects((current) =>
          current.map((project) =>
            project.id !== job.projectId
              ? project
              : {
                  ...project,
                  cards: project.cards.map((currentCard) => {
                    if (currentCard.id !== job.cardId) return currentCard;
                    const currentFrames =
                      currentCard.versions?.find(
                        (version) => version.id === (job.versionId ?? currentCard.activeVersionId)
                      )?.frames ??
                      currentCard.frames ??
                      [];
                    const currentBeforeIndex = currentFrames.findIndex(
                      (item) => item.id === job.request.inBetweenFrames?.beforeFrameId
                    );
                    const currentAfterIndex = currentFrames.findIndex(
                      (item) => item.id === job.request.inBetweenFrames?.afterFrameId
                    );
                    const currentInsertionAt =
                      currentBeforeIndex >= 0 && currentAfterIndex === currentBeforeIndex + 1
                        ? currentAfterIndex
                        : Math.max(0, currentBeforeIndex + 1);
                    const nextFrames = [
                      ...currentFrames.slice(0, currentInsertionAt),
                      frame,
                      ...currentFrames.slice(currentInsertionAt),
                    ];
                    const versions = (currentCard.versions ?? []).map((version) =>
                      version.id === (job.versionId ?? currentCard.activeVersionId)
                        ? { ...version, frames: nextFrames }
                        : version
                    );
                    return {
                      ...currentCard,
                      frames:
                        currentCard.activeVersionId === (job.versionId ?? currentCard.activeVersionId)
                          ? nextFrames
                          : currentCard.frames,
                      versions,
                    };
                  }),
                }
          )
        );
        setGenerationJobs((current) =>
          current.map((item) =>
            item.id === job.id
              ? { ...job, status: "succeeded", progress: 100, outputImageKey, updatedAt: new Date().toISOString() }
              : item
          )
        );
        setFoundationNotice("AI in-between frame generated and inserted into the timeline.");
        return true;
      }
      if (job.target === "frame-edit") {
        const frameId = job.request.frameEdit?.frameId;
        if (!frameId) throw new Error("This frame touch-up job is missing its target frame.");
        const editedCard = currentProjects
          .find((item) => item.id === job.projectId)
          ?.cards.find((entry) => entry.id === job.cardId);
        const previousEditKeys = [
          ...(editedCard?.frames ?? []),
          ...(editedCard?.versions ?? []).flatMap((version) => version.frames),
        ]
          .filter((frame) => frame.id === frameId && frame.editImageKey && frame.editImageKey !== outputImageKey)
          .map((frame) => frame.editImageKey as string);
        setProjects((current) =>
          current.map((project) =>
            project.id !== job.projectId
              ? project
              : {
                  ...project,
                  cards: project.cards.map((currentCard) => {
                    if (currentCard.id !== job.cardId) return currentCard;
                    const attach = (frame: StudioFrame): StudioFrame =>
                      frame.id === frameId ? { ...frame, editImageKey: outputImageKey } : frame;
                    return {
                      ...currentCard,
                      frames: (currentCard.frames ?? []).map(attach),
                      versions: (currentCard.versions ?? []).map((version) => ({
                        ...version,
                        frames: version.frames.map(attach),
                      })),
                    };
                  }),
                }
          )
        );
        const staleEdits = unreferencedImageKeys(currentProjects, [...new Set(previousEditKeys)], job.cardId);
        if (staleEdits.length) await deleteImages(staleEdits).catch(() => undefined);
        setGenerationJobs((current) =>
          current.map((item) =>
            item.id === job.id
              ? { ...job, status: "succeeded", progress: 100, outputImageKey, updatedAt: new Date().toISOString() }
              : item
          )
        );
        setFoundationNotice(
          "AI touch-up complete. The frame now shows the edited copy; revert restores the original at any time."
        );
        return true;
      }
      setProjects((current) =>
        current.map((item) => {
          if (item.id !== job.projectId) return item;
          if (job.target === "anchor") {
            const version: AnchorVersion = {
              id: makeId(),
              imageKey: outputImageKey,
              name: `Anchor v${(item.anchorVersions?.length ?? 0) + 1}`,
              source: "generated",
              prompt: job.request.prompt,
              artMode: item.anchorArtMode ?? "pixel",
              direction: item.anchorDirection ?? "front",
              pivot: item.anchorPivot,
              createdAt: new Date().toISOString(),
            };
            return {
              ...item,
              anchorVersionId: version.id,
              anchorVersions: [...(item.anchorVersions ?? []), version],
              anchorName: version.name,
              anchorPrompt: job.request.prompt,
              anchorPreview: "",
            };
          }
          return {
            ...item,
            cards: item.cards.map((card) => {
              if (card.id !== job.cardId) return card;
              if (job.target === "animation-frame") {
                const phase = card.phases?.find((entry) => entry.id === job.phaseId);
                const frame: StudioFrame = {
                  id: makeId(),
                  imageKey: outputImageKey,
                  name: phase?.label ?? `Frame ${(job.frameIndex ?? 0) + 1}`,
                  phaseId: job.phaseId,
                  phaseIndex: job.frameIndex,
                  offsetX: 0,
                  offsetY: 0,
                  pivotX: job.request.width / 2,
                  pivotY: job.request.height * 0.9,
                  durationMs: Math.round(1000 / Math.max(card.fps ?? 8, 1)),
                };
                const versionFrames = card.versions?.find((version) => version.id === job.versionId)?.frames ?? [];
                const nextFrames = [...versionFrames, frame].sort(
                  (left, right) => (left.phaseIndex ?? 999) - (right.phaseIndex ?? 999)
                );
                const versions = (card.versions ?? []).map((version) =>
                  version.id === job.versionId ? { ...version, frames: nextFrames } : version
                );
                return {
                  ...card,
                  frames: job.versionId === card.activeVersionId ? nextFrames : card.frames,
                  versions,
                  anchorVersionId: job.anchorVersionId ?? card.anchorVersionId,
                };
              }
              if (job.layerIndex) {
                const layer: AssetLayer = {
                  id: makeId(),
                  layerIndex: job.layerIndex,
                  imageKey: outputImageKey,
                  prompt: job.request.prompt,
                  createdAt: new Date().toISOString(),
                };
                const layers = [
                  ...(card.assetLayers ?? []).filter((entry) => entry.layerIndex !== job.layerIndex),
                  layer,
                ].sort((left, right) => left.layerIndex - right.layerIndex);
                return {
                  ...card,
                  assetLayers: layers,
                  generatedImageKey: outputImageKey,
                  anchorVersionId: job.anchorVersionId ?? card.anchorVersionId,
                };
              }
              const assetVersion: AssetVersion = {
                id: makeId(),
                number: (card.assetVersions?.length ?? 0) + 1,
                imageKey: outputImageKey,
                prompt: job.request.prompt,
                createdAt: new Date().toISOString(),
              };
              return {
                ...card,
                generatedImageKey: outputImageKey,
                assetVersions: [...(card.assetVersions ?? []), assetVersion],
                activeAssetVersionId: assetVersion.id,
                assetLayers: [],
                anchorVersionId: job.anchorVersionId ?? card.anchorVersionId,
              };
            }),
          };
        })
      );
      setGenerationJobs((current) =>
        current.map((item) =>
          item.id === job.id
            ? { ...job, status: "succeeded", progress: 100, outputImageKey, updatedAt: new Date().toISOString() }
            : item
        )
      );
      if (job.target === "anchor") setFoundationNotice("Anchor generation complete.");
      return true;
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const message = error instanceof Error ? error.message : "Generation failed.";
      setGenerationJobs((current) =>
        current.map((item) =>
          item.id === job.id
            ? {
                ...job,
                status: cancelled ? "cancelled" : "failed",
                progress: 0,
                error: message,
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
      // Failures otherwise only appear inside the job panel, which starts closed; make the
      // reason visible in the workspace so a returned-but-unusable response is not silent.
      setFoundationNotice(
        cancelled ? `${generationJobLabel(job)} cancelled.` : `${generationJobLabel(job)} failed: ${message}`
      );
      return false;
    } finally {
      generationControllers.current.delete(job.id);
      if (job.target === "anchor") setIsGeneratingAnchor(false);
      if (job.cardId) setGeneratingCardId(null);
    }
  }

  async function withTimeout<T>(operation: Promise<T>, controller: AbortController, timeoutMs: number): Promise<T> {
    let timer = 0;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = window.setTimeout(() => {
            controller.abort();
            reject(new Error("Provider request timed out after 3 minutes."));
          }, timeoutMs);
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  function cancelGeneration(jobId: string) {
    const running = generationControllers.current.get(jobId);
    if (running) running.abort();
    else {
      cancelledGenerationIds.current.add(jobId);
      setGenerationJobs((current) =>
        current.map((job) =>
          job.id === jobId && job.status === "queued"
            ? { ...job, status: "cancelled", updatedAt: new Date().toISOString() }
            : job
        )
      );
    }
  }

  function retryGeneration(job: GenerationJob) {
    const retry = {
      ...job,
      id: makeId(),
      status: "queued" as const,
      progress: 0,
      error: undefined,
      outputImageKey: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setGenerationJobs((current) => [retry, ...current]);
    void enqueueGeneration(retry);
  }

  return {
    generationJobs,
    setGenerationJobs,
    makeGenerationJob,
    enqueueGeneration,
    cancelGeneration,
    retryGeneration,
  };
}
