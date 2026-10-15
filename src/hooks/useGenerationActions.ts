import type { Dispatch, SetStateAction } from "react";
import type { AnimationVersion, ProviderProfile, StudioCard, StudioFrame, StudioProject } from "../types";
import { activeFrameImageKey } from "../types";
import type { AppView } from "../components/Sidebar";
import { loadImage, saveImage } from "../imageStore";
import { normalizedCanvas, resolveCardCanvas } from "../productFoundation";
import { getProviderSecret } from "../providerSecrets";
import { videoCostUsd, supportsFramePinning } from "../videoProvider";
import { videoLoopPresetById } from "../data/videoLoopPresets";
import { dataUrlToBlob } from "../lib/imageUtils";
import { makeId } from "../lib/ids";
import type { useGenerationJobs } from "./useGenerationJobs";

type JobHelpers = Pick<ReturnType<typeof useGenerationJobs>, "makeGenerationJob" | "enqueueGeneration">;

export function useGenerationActions({
  activeProject,
  activeProvider,
  setActiveView,
  setFoundationNotice,
  setProviderMessage,
  updateCard,
  makeGenerationJob,
  enqueueGeneration,
}: {
  activeProject: StudioProject | null;
  activeProvider: ProviderProfile | null;
  setActiveView: Dispatch<SetStateAction<AppView>>;
  setFoundationNotice: (message: string) => void;
  setProviderMessage: (message: string) => void;
  updateCard: (projectId: string, cardId: string, update: (card: StudioCard) => StudioCard) => void;
} & JobHelpers) {
  async function generateAnchor(prompt: string) {
    if (!activeProject || !activeProvider) return;
    if (
      !window.confirm(
        `Generate an anchor with ${activeProvider.name} / ${activeProvider.imageModel ?? activeProvider.model}? This may incur charges.`
      )
    )
      return;
    await enqueueGeneration(
      makeGenerationJob({
        project: activeProject,
        provider: activeProvider,
        prompt: `${prompt}\n\nArt direction: ${activeProject.anchorArtMode === "hd" ? "Detailed HD 2D art" : "Crisp pixel art"}, ${activeProject.anchorDirection ?? "front"} view. Transparent background. Preserve a clear readable silhouette.`,
        dimensions: normalizedCanvas(activeProject.size, activeProject.canvasSize),
        target: "anchor",
      })
    );
  }

  async function generateAssetForCard(card: StudioCard) {
    if (!activeProject || !activeProvider) return;
    try {
      await getProviderSecret(activeProvider.id);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter the provider API key before generating.");
      setActiveView("settings");
      setFoundationNotice(
        "Add the API key to the selected provider. In browser mode it is kept for this session only."
      );
      return;
    }
    const dimensions = resolveCardCanvas(activeProject, card);
    const anchorKey = activeProject.anchorVersions?.find(
      (version) => version.id === (card.anchorVersionId ?? activeProject.anchorVersionId)
    )?.imageKey;
    const anchorVersionId = card.anchorVersionId ?? activeProject.anchorVersionId;
    const anchorReferenceKey = card.kind === "asset" && card.useAnchorReference ? anchorKey : undefined;
    const referenceImageKey = card.kind === "asset" ? (card.referenceImageKey ?? anchorReferenceKey) : anchorKey;
    const extraReferenceKeys =
      card.kind === "asset"
        ? Array.from(
            new Set(
              [card.referenceImageKey, anchorReferenceKey].filter(
                (key): key is string => Boolean(key) && key !== referenceImageKey
              )
            )
          )
        : [];
    const usingReference = Boolean(referenceImageKey) || extraReferenceKeys.length > 0;
    const layerCount = Math.max(1, Math.min(4, card.layerCount ?? 1));
    const referenceNote =
      card.kind === "asset"
        ? referenceImageKey === anchorReferenceKey && !extraReferenceKeys.length
          ? " The project anchor image will guide the style."
          : card.referenceImageKey && anchorReferenceKey
            ? " The card's own reference image and the project anchor will guide the style."
            : " The card's own reference image will guide the style."
        : " The anchor image will define the character.";
    if (
      !window.confirm(
        `Generate “${card.name}” with ${activeProvider.name} / ${activeProvider.imageModel ?? activeProvider.model}?${usingReference ? referenceNote : ""}${layerCount > 1 ? ` This generates ${layerCount} isolated layers from this prompt.` : ""} This sends the reference image to the provider and may incur charges.`
      )
    )
      return;
    const variations = Math.max(1, Math.min(8, card.variationCount ?? 1));
    const batchId = makeId();
    const appliedSkill = card.skillSnapshot;
    const promptTemplate = appliedSkill?.promptTemplate ?? card.prompt;
    const resolvedPrompt = promptTemplate
      .replaceAll("{subject}", card.name)
      .replaceAll("{style}", card.artMode === "hd" ? "smooth HD illustration" : "crisp pixel art")
      .replaceAll("{motion}", "standalone game asset");
    const anchorNote = anchorReferenceKey
      ? "\n\nUse the provided anchor image as the visual anchor: match its style, palette, and design language."
      : "";
    const prompt = `${resolvedPrompt}\n\nArt direction: ${card.artMode === "hd" ? "smooth detailed HD 2D art" : "crisp pixel art with a limited palette"}. ${card.transparentBackground === false ? "Use a simple solid background." : "Use a transparent background."} Generate variation {variation} of ${variations}. Keep the asset isolated, centered, and readable.${anchorNote}`;
    for (let index = 0; index < variations; index++) {
      for (let layer = 1; layer <= layerCount; layer++) {
        const layerSuffix =
          layerCount > 1
            ? `\n\nLayer ${layer} of ${layerCount}: render only this one isolated component of the asset on a fully transparent background; exclude every other part.`
            : "";
        const layerPrompt = prompt
          .replace("{variation}", `${index + 1}/${variations}`)
          .replace(/\{layer\}|\[layer\]/gi, String(layer));
        const job = makeGenerationJob({
          project: activeProject,
          provider: activeProvider,
          card,
          prompt: layerPrompt + layerSuffix,
          dimensions,
          target: "asset",
          referenceImageKey,
          anchorVersionId,
          batchId,
          versionId: batchId,
          variationIndex: index,
          layerIndex: layerCount > 1 ? layer : undefined,
        });
        if (extraReferenceKeys.length) job.request.referenceImageKeys = extraReferenceKeys;
        await enqueueGeneration(job);
      }
    }
  }

  async function generateAnimationCard(card: StudioCard) {
    if (!activeProject || !activeProvider) return;
    const phases = card.phases ?? [];
    try {
      await getProviderSecret(activeProvider.id);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter the provider API key before generating.");
      setActiveView("settings");
      setFoundationNotice(
        "Add the API key to the selected provider. In browser mode it is kept for this session only."
      );
      return;
    }
    if (
      !window.confirm(
        `Generate one eight-frame animation sheet for “${card.name}” with ${activeProvider.name}? Only the selected anchor is sent as the character reference. This may incur charges.`
      )
    )
      return;
    const dimensions = { width: 2048, height: 256 };
    const anchorVersionId = card.anchorVersionId ?? activeProject.anchorVersionId;
    const referenceImageKey = activeProject.anchorVersions?.find((version) => version.id === anchorVersionId)?.imageKey;
    if (!referenceImageKey) {
      setFoundationNotice("Choose or upload a project anchor before generating animation frames.");
      return;
    }
    const batchId = makeId();
    const frameCount = 8;
    const version: AnimationVersion = {
      id: batchId,
      number: (card.versions?.length ?? 0) + 1,
      createdAt: new Date().toISOString(),
      prompt: card.prompt,
      phases: phases.slice(0, frameCount),
      frames: [],
      fps: card.fps ?? 8,
      loop: card.loop ?? true,
      size: "custom",
      canvasSize: { width: 256, height: 256 },
      anchorVersionId,
    };
    updateCard(activeProject.id, card.id, (current) => ({
      ...current,
      versions: [...(current.versions ?? []), version],
      activeVersionId: version.id,
      frames: [],
    }));
    const promptTemplate = card.skillSnapshot?.promptTemplate ?? card.prompt;
    const resolvedPrompt = promptTemplate
      .replaceAll("{subject}", card.name)
      .replaceAll("{style}", "consistent game sprite art")
      .replaceAll("{motion}", phases.map((phase) => phase.label).join(", "));
    const phaseInstructions = Array.from({ length: frameCount }, (_, index) => {
      const phase = phases[index];
      return `Frame ${index + 1}: ${phase?.label ?? `Cycle pose ${index + 1}`} — ${phase?.prompt ?? "A distinct in-between pose; maintain the same body scale and ground line."}`;
    }).join("\n");
    const prompt = `${resolvedPrompt}\n\nUse the single input image as the exact character design reference. Generate one animation sheet with exactly 8 frames of ${card.name}, arranged as 4 columns by 2 rows, in chronological order from left to right and then top to bottom. Use equal-sized, borderless cells. Each cell will be cropped into one square 256 × 256 animation frame. Put exactly one complete pose of the same character in each cell. Keep character identity, proportions, facing, outfit, colors, style, scale, and ground line consistent. Center each character inside its cell. No margins, gutters, dividers, labels, text, scenery, or extra frames. Make the motion loop smoothly from frame 8 back to frame 1.\n\nPose sequence, left to right and top to bottom:\n${phaseInstructions}`;
    await enqueueGeneration(
      makeGenerationJob({
        project: activeProject,
        provider: activeProvider,
        card,
        prompt,
        dimensions,
        target: "animation-frame",
        referenceImageKey,
        anchorVersionId,
        frameIndex: 0,
        batchId,
        versionId: batchId,
      })
    );
  }

  async function generateInBetweenFrame(card: StudioCard, before: StudioFrame, after: StudioFrame) {
    if (!activeProject || !activeProvider) return;
    if (activeProvider.providerType !== "openai-compatible" || activeProvider.capabilities?.imageToImage === false) {
      setFoundationNotice(
        "In-between generation needs an OpenAI-compatible provider with image edits enabled, so it can use both selected frames as references."
      );
      return;
    }
    try {
      await getProviderSecret(activeProvider.id);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter the provider API key before generating.");
      setActiveView("settings");
      setFoundationNotice("Add an image-edit capable provider and API key before generating in-between frames.");
      return;
    }
    const firstIndex = (card.frames ?? []).findIndex((frame) => frame.id === before.id);
    const secondIndex = (card.frames ?? []).findIndex((frame) => frame.id === after.id);
    const [earlier, later] = firstIndex <= secondIndex ? [before, after] : [after, before];
    if (
      !window.confirm(
        `Generate an in-between pose for “${card.name}” using “${earlier.name}” and “${later.name}” as references with ${activeProvider.name} / ${activeProvider.imageModel ?? activeProvider.model}? This sends both frames to the provider and may incur charges.`
      )
    )
      return;
    const versionId = card.activeVersionId;
    const job = makeGenerationJob({
      project: activeProject,
      provider: activeProvider,
      card,
      prompt: `Create a single standalone animation frame for ${card.name}. OUTPUT EXACTLY ONE IMAGE WITH EXACTLY ONE CHARACTER POSE. This is one frame, not a sprite sheet, not a grid, not a storyboard, not a contact sheet, and not a collage. The first reference image is the pose immediately before the desired frame; the second reference is the pose immediately after it. Draw one new midpoint pose that smoothly bridges those two poses in the motion. Return only one complete character, one pose, filling one square frame. Do not divide the image into cells or panels. Do not show multiple versions, poses, or characters. Preserve the exact character identity, proportions, outfit, facing direction, palette, pixel-art style, scale, and ground line from the references. Use a transparent background. Do not add scenery, text, labels, borders, gutters, or extra content. Animation direction: ${card.prompt || "follow the established motion"}.`,
      dimensions: resolveCardCanvas(activeProject, card),
      target: "inbetween-frame",
      anchorVersionId: card.anchorVersionId,
      versionId,
    });
    job.request.referenceImageKeys = [earlier.imageKey, later.imageKey];
    job.request.inBetweenFrames = { beforeFrameId: earlier.id, afterFrameId: later.id };
    await enqueueGeneration(job);
  }

  async function touchUpFrameWithAI(card: StudioCard, frame: StudioFrame, instruction: string) {
    if (!activeProject || !activeProvider) return;
    if (!activeProvider.capabilities?.imageToImage) {
      setFoundationNotice("Enable image edits in provider settings or choose a provider with image-to-image support.");
      return;
    }
    try {
      await getProviderSecret(activeProvider.id);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter the provider API key before generating.");
      setActiveView("settings");
      setFoundationNotice(
        "Add the API key to the selected provider. In browser mode it is kept for this session only."
      );
      return;
    }
    const sourceKey = activeFrameImageKey(frame);
    const source = await loadImage(sourceKey);
    if (!source) {
      setFoundationNotice("The selected frame image could not be loaded from local storage.");
      return;
    }
    if (
      !window.confirm(
        `Touch up “${frame.name}” from “${card.name}” with ${activeProvider.name} / ${activeProvider.imageModel ?? activeProvider.model}? This sends the frame to the provider and may incur charges. The original frame is kept; the edited copy can be reverted at any time.`
      )
    )
      return;
    const job = makeGenerationJob({
      project: activeProject,
      provider: activeProvider,
      card,
      prompt: `Edit the single input image, which is one animation frame of ${card.name}. Return exactly one edited version of this same frame. ${instruction.trim()}\n\nStrictly preserve the character identity, pose, silhouette, proportions, facing direction, palette, art style, scale, and ground position of the input frame. Change only what the instruction above asks for. Use a transparent background. Output exactly one image with exactly one character pose: no sprite sheet, grid, panels, text, labels, borders, scenery, or extra content.`,
      dimensions: resolveCardCanvas(activeProject, card),
      target: "frame-edit",
      anchorVersionId: card.anchorVersionId,
      versionId: card.activeVersionId,
    });
    job.request.referenceImageKeys = [sourceKey];
    job.request.frameEdit = { frameId: frame.id };
    await enqueueGeneration(job);
  }

  async function generateVideoAnimation(card: StudioCard) {
    if (!activeProject || !activeProvider) return;
    const isGrok = activeProvider.providerType === "grok" || activeProvider.baseUrl.includes("api.x.ai");
    if (!isGrok) {
      setFoundationNotice("Video generation currently requires a Grok (xAI) provider profile.");
      return;
    }
    const model = activeProvider.videoModel;
    if (!model) {
      setProviderMessage("Set a Video model ID in provider settings first, for example grok-imagine-video-1.5-lite.");
      setActiveView("settings");
      return;
    }
    try {
      await getProviderSecret(activeProvider.id);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter the provider API key before generating.");
      setActiveView("settings");
      setFoundationNotice(
        "Add the API key to the selected provider. In browser mode it is kept for this session only."
      );
      return;
    }
    const duration = Math.max(2, Math.min(6, card.videoDuration ?? 4));
    const anchorVersionId = card.kind === "asset" ? undefined : (card.anchorVersionId ?? activeProject.anchorVersionId);
    const anchorImageKey = activeProject.anchorVersions?.find((version) => version.id === anchorVersionId)?.imageKey;
    const referenceImageKey =
      card.kind === "asset" ? (card.generatedImageKey ?? card.referenceImageKey ?? anchorImageKey) : anchorImageKey;
    if (!referenceImageKey) {
      setFoundationNotice(
        card.kind === "asset"
          ? "Generate the asset image before animating it into a video clip."
          : "Choose or upload a project anchor before generating a video clip."
      );
      return;
    }
    const pinLoop = Boolean(card.videoPinLoop) && supportsFramePinning(model);
    const preset = videoLoopPresetById(card.videoLoopPreset);
    const sourceLabel = card.kind === "asset" ? "asset image" : "anchor image";
    const motionPrompt = card.prompt.trim() ? `${preset.prompt} Motion focus: ${card.prompt.trim()}` : preset.prompt;
    const prompt = `${motionPrompt}\n\nAnimation direction: animate the character from the input image, which is the first frame. Fixed camera, character stays centered at the same scale and ground line, keep the flat solid bright green (#00FF00) chroma-key background unchanged, identical first and last pose so the motion loops seamlessly. One character only, no camera movement, no text, no shadows on the background.`;
    if (
      !window.confirm(
        `Animate the ${sourceLabel} into a ${duration}s ${model} video clip for “${card.name}”?${pinLoop ? " The same image is pinned as both the first and last frame for a seamless loop." : ""} Estimated cost: about $${videoCostUsd(model, duration).toFixed(2)}. The clip is saved locally; you choose frames to keep afterwards.`
      )
    )
      return;
    const job = makeGenerationJob({
      project: activeProject,
      provider: activeProvider,
      card,
      prompt,
      dimensions: { width: 480, height: 480 },
      target: "video-animation",
      referenceImageKey,
      anchorVersionId,
    });
    job.video = { model, duration, resolution: "480p", lastFrameImageKey: pinLoop ? referenceImageKey : undefined };
    await enqueueGeneration(job);
  }

  async function editAnchorImage(prompt: string) {
    if (!activeProject || !activeProvider || !activeProject.anchorVersionId) return;
    if (!activeProvider.capabilities?.imageToImage) {
      setFoundationNotice("Enable image edits in provider settings or choose a provider with image-to-image support.");
      return;
    }
    const currentVersion = activeProject.anchorVersions?.find(
      (version) => version.id === activeProject.anchorVersionId
    );
    const source = currentVersion
      ? await loadImage(currentVersion.imageKey)
      : activeProject.anchorPreview
        ? dataUrlToBlob(activeProject.anchorPreview, "image/png")
        : undefined;
    if (!source) {
      setFoundationNotice("The selected anchor image could not be loaded.");
      return;
    }
    if (
      !window.confirm(
        `Create a new anchor version by editing the current anchor with ${activeProvider.name}? This may incur charges.`
      )
    )
      return;
    const dimensions = normalizedCanvas(activeProject.size, activeProject.canvasSize);
    const job = makeGenerationJob({
      project: activeProject,
      provider: activeProvider,
      prompt,
      dimensions,
      target: "anchor",
      referenceImageKey: currentVersion?.imageKey ?? `anchor-edit-${makeId()}`,
    });
    if (!currentVersion?.imageKey) await saveImage(job.request.referenceImageKey!, source);
    await enqueueGeneration(job);
  }

  return {
    generateAnchor,
    generateAssetForCard,
    generateAnimationCard,
    generateInBetweenFrame,
    generateVideoAnimation,
    editAnchorImage,
    touchUpFrameWithAI,
  };
}
