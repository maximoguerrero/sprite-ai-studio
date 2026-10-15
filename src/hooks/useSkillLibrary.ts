import { useState, type FormEvent } from "react";
import type { ProviderProfile, SavedSkill, SpriteSize, StudioCard, StudioProject } from "../types";
import { downloadBlob } from "../spriteSheet";
import { generateText } from "../openAIProvider";
import { makeId } from "../lib/ids";
import { parseSkill, parseSkillsMarkdown, renderSkillMarkdown, starterSkills } from "../lib/skills";

export function useSkillLibrary({
  projects,
  setProjects,
  setDialog,
  activeProject,
  providerProfiles,
}: {
  projects: StudioProject[];
  setProjects: (update: (current: StudioProject[]) => StudioProject[]) => void;
  setDialog: (dialog: "project" | "animation" | "asset" | "skill" | null) => void;
  activeProject: StudioProject | null;
  providerProfiles: ProviderProfile[];
}) {
  const [skills, setSkills] = useState<SavedSkill[]>(starterSkills);
  const [editingSkill, setEditingSkill] = useState<SavedSkill | null>(null);
  const [skillImportMessage, setSkillImportMessage] = useState("");
  const [skillFileInput, setSkillFileInput] = useState<HTMLInputElement | null>(null);

  function saveCardAsSkill(
    card: StudioCard,
    settings: { fps: number; loop: boolean; frameCount: number; size?: SpriteSize }
  ) {
    const name = window.prompt("Name this reusable skill", `${card.name} recipe`);
    if (!name?.trim()) return;
    const skill: SavedSkill = {
      schemaVersion: 1,
      id: makeId(),
      name: name.trim(),
      category: card.kind,
      description: `Saved from the ${card.name} card.`,
      promptTemplate: card.prompt,
      defaults: {
        fps: settings.fps,
        loop: settings.loop,
        frameCount: settings.frameCount,
        ...(settings.size ? { size: settings.size } : {}),
      },
      projectId: activeProject?.id,
      updatedAt: new Date().toLocaleDateString(),
    };
    if (activeProject)
      setProjects((current) =>
        current.map((project) =>
          project.id === activeProject.id ? { ...project, skills: [skill, ...(project.skills ?? [])] } : project
        )
      );
    else setSkills((current) => [skill, ...current]);
  }

  function saveSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const size = String(data.get("size") || "") as SpriteSize | "";
    const projectId = String(data.get("projectId") || "") || undefined;
    const skill: SavedSkill = {
      schemaVersion: 1,
      id: editingSkill?.id ?? makeId(),
      name: String(data.get("name") || "New skill").trim(),
      category: String(data.get("category") || "general") as SavedSkill["category"],
      description: String(data.get("description") || "").trim() || undefined,
      promptTemplate: String(data.get("prompt") || "").trim(),
      negativePrompt: String(data.get("negativePrompt") || "").trim() || undefined,
      defaults: {
        ...(size ? { size } : {}),
        pixelArt: data.get("pixelArt") === "on",
        transparentBackground: data.get("transparentBackground") === "on",
        ...(data.get("frameCount") ? { frameCount: Number(data.get("frameCount")) } : {}),
        ...(data.get("fps") ? { fps: Number(data.get("fps")) } : {}),
        loop: data.get("loop") === "on",
      },
      workflowNotes: String(data.get("notes") || "")
        .split("\n")
        .map((note) => note.trim())
        .filter(Boolean),
      projectId,
      updatedAt: new Date().toLocaleDateString(),
    };
    const priorProjectId = editingSkill?.projectId;
    const templateDefaults = editingSkill?.defaults ?? {};
    skill.defaults = {
      ...skill.defaults,
      ...(!data.has("frameCount") && templateDefaults.frameCount ? { frameCount: templateDefaults.frameCount } : {}),
      ...(!data.has("fps") && templateDefaults.fps ? { fps: templateDefaults.fps } : {}),
    };
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== priorProjectId && project.id !== skill.projectId) return project;
        const remaining = (project.skills ?? []).filter((entry) => entry.id !== skill.id);
        return { ...project, skills: project.id === skill.projectId ? [skill, ...remaining] : remaining };
      })
    );
    setSkills((current) => {
      const remaining = current.filter((entry) => entry.id !== skill.id);
      return skill.projectId ? remaining : [skill, ...remaining];
    });
    if (priorProjectId !== skill.projectId)
      setProjects((current) =>
        current.map((project) => {
          if (project.id !== priorProjectId && project.id !== skill.projectId) return project;
          const remaining = (project.skills ?? []).filter((entry) => entry.id !== skill.id);
          return { ...project, skills: project.id === skill.projectId ? [skill, ...remaining] : remaining };
        })
      );
    setEditingSkill(null);
    setDialog(null);
  }

  function openSkillEditor(skill?: SavedSkill) {
    setEditingSkill(skill ?? null);
    setDialog("skill");
  }

  function duplicateSkill(skill: SavedSkill) {
    const duplicate = {
      ...structuredClone(skill),
      id: makeId(),
      name: `${skill.name} copy`,
      updatedAt: new Date().toLocaleDateString(),
    };
    if (skill.projectId)
      setProjects((current) =>
        current.map((project) =>
          project.id === skill.projectId ? { ...project, skills: [duplicate, ...(project.skills ?? [])] } : project
        )
      );
    else setSkills((current) => [duplicate, ...current]);
  }

  function exportSkills() {
    const payload = {
      format: "sprite-studio-skills/v1",
      skills: [...skills, ...projects.flatMap((project) => project.skills ?? [])],
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      "sprite-studio-skills.json"
    );
  }

  function exportSkillsMarkdown() {
    downloadBlob(
      new Blob([renderSkillMarkdown([...skills, ...projects.flatMap((project) => project.skills ?? [])])], {
        type: "text/markdown",
      }),
      "sprite-studio-skills.md"
    );
  }

  async function importSkills(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".md")) {
        const markdownSkills = parseSkillsMarkdown(text);
        if (!markdownSkills.length) throw new Error("No skills found in the Markdown file.");
        setSkills((current) => [
          ...markdownSkills.map((skill) => ({
            ...skill,
            id: makeId(),
            projectId: undefined,
            updatedAt: new Date().toLocaleDateString(),
          })),
          ...current,
        ]);
        setSkillImportMessage(`Imported ${markdownSkills.length} skill${markdownSkills.length === 1 ? "" : "s"}.`);
        return;
      }
      const parsed: unknown = JSON.parse(text);
      const payload = parsed as { skills?: unknown[] };
      const entries = Array.isArray(payload.skills) ? payload.skills : Array.isArray(parsed) ? parsed : [parsed];
      const valid = entries.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill));
      if (!valid.length) throw new Error("No valid skills found. Check the skill JSON format.");
      setSkills((current) => [
        ...valid.map((skill) => ({
          ...skill,
          id: makeId(),
          projectId: undefined,
          updatedAt: new Date().toLocaleDateString(),
        })),
        ...current,
      ]);
      setSkillImportMessage(`Imported ${valid.length} skill${valid.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setSkillImportMessage(error instanceof Error ? error.message : "Could not import skill file.");
    }
  }

  function deleteSkill(skill: SavedSkill) {
    if (!window.confirm(`Delete “${skill.name}” from your skills library?`)) return;
    if (skill.projectId)
      setProjects((current) =>
        current.map((project) =>
          project.id === skill.projectId
            ? { ...project, skills: (project.skills ?? []).filter((entry) => entry.id !== skill.id) }
            : project
        )
      );
    else setSkills((current) => current.filter((entry) => entry.id !== skill.id));
  }

  async function rewriteSkillPrompt(current: {
    name: string;
    description?: string;
    promptTemplate: string;
    negativePrompt?: string;
  }) {
    const textProvider =
      providerProfiles.find((profile) => profile.modelKind === "text" && profile.enabled !== false) ?? null;
    if (!textProvider) throw new Error("Set a provider profile’s Model type to Text generation in Settings first.");
    if (!current.promptTemplate.trim()) throw new Error("Write a prompt template before rewriting it.");
    const raw = await generateText(textProvider, [
      {
        role: "system",
        content:
          'You rewrite sprite-generation skill recipes into more detailed ones. Reply with strict JSON only: {"description": string, "promptTemplate": string, "negativePrompt": string, "workflowNotes": string[]}. Keep every {placeholder} from the original promptTemplate intact. Expand promptTemplate into a richer, more specific image-generation prompt covering subject, style, palette, framing, and background.',
      },
      {
        role: "user",
        content: JSON.stringify({
          name: current.name,
          description: current.description ?? "",
          promptTemplate: current.promptTemplate,
          negativePrompt: current.negativePrompt ?? "",
        }),
      },
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The text model did not return a rewritten skill.");
    const parsed = JSON.parse(match[0]) as {
      description?: string;
      promptTemplate?: string;
      negativePrompt?: string;
      workflowNotes?: string[];
    };
    if (!parsed.promptTemplate?.trim()) throw new Error("The rewritten prompt template was empty.");
    return {
      description: parsed.description?.trim() || current.description || "",
      promptTemplate: parsed.promptTemplate.trim(),
      negativePrompt: parsed.negativePrompt?.trim() ?? current.negativePrompt ?? "",
      workflowNotes: Array.isArray(parsed.workflowNotes)
        ? parsed.workflowNotes.map((note) => String(note).trim()).filter(Boolean)
        : undefined,
    };
  }

  async function rewriteCardPrompt(current: { name: string; prompt: string }) {
    const textProvider =
      providerProfiles.find((profile) => profile.modelKind === "text" && profile.enabled !== false) ?? null;
    if (!textProvider) throw new Error("Set a provider profile’s Model type to Text generation in Settings first.");
    if (!current.prompt.trim()) throw new Error("Write a prompt before rewriting it.");
    const raw = await generateText(textProvider, [
      {
        role: "system",
        content:
          'You rewrite sprite and game-asset concept prompts into richer image-generation prompts. Reply with strict JSON only: {"prompt": string}. Keep every {layer} or [layer] placeholder intact. Expand the prompt into a richer, more specific image prompt covering subject, style, palette, framing, and background.',
      },
      { role: "user", content: JSON.stringify({ name: current.name, prompt: current.prompt }) },
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The text model did not return a rewritten prompt.");
    const parsed = JSON.parse(match[0]) as { prompt?: string };
    if (!parsed.prompt?.trim()) throw new Error("The rewritten prompt was empty.");
    return parsed.prompt.trim();
  }

  async function rewriteMotionPrompt(current: { name: string; prompt: string }) {
    const textProvider =
      providerProfiles.find((profile) => profile.modelKind === "text" && profile.enabled !== false) ?? null;
    if (!textProvider) throw new Error("Set a provider profile’s Model type to Text generation in Settings first.");
    if (!current.prompt.trim()) throw new Error("Write a motion prompt before rewriting it.");
    const raw = await generateText(textProvider, [
      {
        role: "system",
        content:
          'You rewrite animation motion prompts for sprite animation and image-to-video generation. Reply with strict JSON only: {"prompt": string}. Expand the prompt into a richer motion description covering the action, movement direction, timing, loop behavior, and what must stay consistent between frames, character is always visible in the frame, no clipping. Do not describe a still portrait; describe movement.',
      },
      { role: "user", content: JSON.stringify({ name: current.name, prompt: current.prompt }) },
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The text model did not return a rewritten motion prompt.");
    const parsed = JSON.parse(match[0]) as { prompt?: string };
    if (!parsed.prompt?.trim()) throw new Error("The rewritten motion prompt was empty.");
    return parsed.prompt.trim();
  }

  return {
    skills,
    setSkills,
    saveCardAsSkill,
    editingSkill,
    setEditingSkill,
    skillImportMessage,
    skillFileInput,
    setSkillFileInput,
    saveSkill,
    openSkillEditor,
    duplicateSkill,
    exportSkills,
    exportSkillsMarkdown,
    importSkills,
    deleteSkill,
    rewriteSkillPrompt,
    rewriteCardPrompt,
    rewriteMotionPrompt,
  };
}
