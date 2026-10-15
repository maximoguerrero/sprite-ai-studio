import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { AnimationPhase, SavedSkill, SpriteSize, StudioCard, StudioProject } from "../types";
import { saveImage } from "../imageStore";
import { makeId, makeSlug } from "../lib/ids";
import { fillSkillTemplate } from "../lib/skills";
import { animationPresets } from "../data/animationPresets";

export type CardDialog = "project" | "animation" | "asset" | "skill" | null;

export function useCardDraft({
  activeProject,
  dialog,
  setDialog,
  availableSkills,
  setProjects,
  setFoundationNotice,
}: {
  activeProject: StudioProject | null;
  dialog: CardDialog;
  setDialog: Dispatch<SetStateAction<CardDialog>>;
  availableSkills: SavedSkill[];
  setProjects: Dispatch<SetStateAction<StudioProject[]>>;
  setFoundationNotice: (message: string) => void;
}) {
  const [draftSkillId, setDraftSkillId] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftAnimationPreset, setDraftAnimationPreset] = useState("custom");
  const [draftLoop, setDraftLoop] = useState(true);
  const [draftPhases, setDraftPhases] = useState<AnimationPhase[]>([]);
  const [skillVariables, setSkillVariables] = useState<Record<string, string>>({});

  function showCardDialog(kind: "animation" | "asset") {
    setDraftSkillId("");
    setDraftPrompt("");
    setSkillVariables({});
    setDraftAnimationPreset("custom");
    setDraftLoop(true);
    setDraftPhases([]);
    setDialog(kind);
  }

  async function createCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeProject || !dialog || (dialog !== "animation" && dialog !== "asset")) return;
    const data = new FormData(event.currentTarget);
    if (data.get("cardSize") === "custom") {
      for (const field of ["cardWidth", "cardHeight"]) {
        const value = Number(data.get(field));
        if (!Number.isInteger(value) || value < 1 || value > 4096) {
          setFoundationNotice("Custom card dimensions must be whole numbers between 1 and 4096 pixels.");
          return;
        }
      }
    }
    const appliedSkill = availableSkills.find((skill) => skill.id === String(data.get("skillId") || ""));
    const actionPreset =
      dialog === "animation"
        ? animationPresets.find((preset) => preset.id === String(data.get("actionPreset") || "custom"))
        : undefined;
    const poseFile = dialog === "animation" ? null : data.get("referenceImage");
    const uploadedImageKey = poseFile instanceof File && poseFile.size > 0 ? `asset-reference-${makeId()}` : undefined;
    if (uploadedImageKey && poseFile instanceof File) await saveImage(uploadedImageKey, poseFile);
    const sizeSelection = String(data.get("cardSize") || "inherit") as SpriteSize | "inherit";
    const explicitSize = dialog === "animation" ? "custom" : sizeSelection === "inherit" ? undefined : sizeSelection;
    const canvasSize =
      dialog === "animation"
        ? { width: 256, height: 256 }
        : explicitSize === "custom"
          ? { width: Number(data.get("cardWidth")) || 64, height: Number(data.get("cardHeight")) || 64 }
          : undefined;
    const id = makeId();
    const name = String(data.get("name") || (dialog === "animation" ? "New animation" : "New asset")).trim();
    const slug = makeSlug(name, id);
    const initialFrameCount = dialog === "animation" ? 8 : Number(data.get("frameCount")) || actionPreset?.frames || 8;
    const initialFps = Number(data.get("fps")) || 8;
    const shouldLoop = dialog === "animation" ? data.get("loop") === "on" : true;
    const phases =
      dialog === "animation" ? draftPhases.filter((phase) => phase.label.trim() || phase.prompt.trim()) : [];
    const card: StudioCard = {
      id,
      name,
      slug,
      folderPath: `${activeProject.folderPath}/cards/${dialog === "animation" ? "animations" : "assets"}/${slug}`,
      kind: dialog,
      prompt: fillSkillTemplate(String(data.get("prompt") || actionPreset?.prompt || "").trim(), skillVariables),
      createdAt: new Date().toISOString(),
      ...(dialog === "animation" ? { frameCount: initialFrameCount, fps: initialFps, loop: shouldLoop } : {}),
      ...(dialog === "animation"
        ? {
            phases: (phases.length
              ? phases
              : (actionPreset?.phases ?? []).map((label) => ({ id: makeId(), label, prompt: `${label} pose` }))
            ).slice(0, 8),
          }
        : {}),
      ...(activeProject.anchorVersionId ? { anchorVersionId: activeProject.anchorVersionId } : {}),
      ...(dialog === "asset"
        ? {
            ...(uploadedImageKey ? { referenceImageKey: uploadedImageKey } : {}),
            artMode: data.get("artMode") === "hd" ? ("hd" as const) : ("pixel" as const),
            transparentBackground: data.get("transparentBackground") === "on",
            variationCount: Math.max(1, Math.min(8, Number(data.get("variations")) || 1)),
            assetPlacement: { scale: 1, offsetX: 0, offsetY: 0 },
          }
        : {}),
      ...(explicitSize ? { size: explicitSize } : {}),
      ...(canvasSize ? { canvasSize } : {}),
      ...(appliedSkill
        ? {
            skillSnapshot: structuredClone(appliedSkill),
            fps: appliedSkill.defaults.fps ?? initialFps,
            loop: appliedSkill.defaults.loop ?? shouldLoop,
            ...(!explicitSize && appliedSkill.defaults.size ? { size: appliedSkill.defaults.size } : {}),
            frameCount: dialog === "animation" ? 8 : (appliedSkill.defaults.frameCount ?? initialFrameCount),
          }
        : {}),
    };
    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id ? { ...project, cards: [card, ...project.cards] } : project
      )
    );
    setDialog(null);
  }
  return {
    draftSkillId,
    setDraftSkillId,
    draftPrompt,
    setDraftPrompt,
    draftAnimationPreset,
    setDraftAnimationPreset,
    draftLoop,
    setDraftLoop,
    draftPhases,
    setDraftPhases,
    skillVariables,
    setSkillVariables,
    showCardDialog,
    createCard,
  };
}
