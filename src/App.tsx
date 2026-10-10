import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { unzipSync, zipSync } from "fflate";
import type { AnchorVersion, AnimationPhase, AnimationVersion, AssetVersion, CanvasSize, CardKind, GenerationJob, ProviderProfile, SavedSkill, SpriteSize, StudioCard, StudioFrame, StudioProject } from "./types";
import { clearWorkspaceData, deleteImages, listStoredImageKeys, loadImage, loadImages, loadWorkspaceAndJobs, saveGenerationJobs, saveImage, saveWorkspace } from "./imageStore";
import { canvasPng, downloadBlob, encodeAnimatedWebp, encodeApng, encodeGif, frameImagePlacement, framesToZip, renderAnimationFrames, renderCombinedSheet, renderSheet, safeFilename, type CombinedLayout, type ExportAnimation, type FrameLayout } from "./spriteSheet";
import { normalizedCanvas, resolveCardCanvas, writeDirectory, type WritableDirectoryHandle } from "./productFoundation";
import { normalizeAnimationVersion, normalizeFrameTiming } from "./workspaceMigration";
import { isWorkspaceExport, WORKSPACE_SCHEMA_VERSION, type WorkspaceExport } from "./types";
import { generationJobSchema, savedSkillSchema, studioProjectSchema, workspaceExportSchema } from "./schemas";
import { providerProfileSchema } from "./schemas";
import { generateImage, testProviderConnection } from "./openAIProvider";
import { getProviderSecret, isProviderSecretRemembered, removeProviderSecret, saveBrowserProviderSecret, saveProviderSecret } from "./providerSecrets";
import { desktopAvailable, initializeDatabase, syncProjectIndex } from "./database";
import { desktopProjectsDirectory, persistDesktopProjects, writeDesktopProject } from "./desktopFiles";

const PROJECTS_KEY = "sprite-studio.projects.v1";
const SKILLS_KEY = "sprite-studio.skills.v1";
const animationPresets = [
  { id: "custom", label: "Custom", frames: 8, loop: true, prompt: "", phases: ["Starting pose", "Action", "End pose"] },
  { id: "idle", label: "Idle", frames: 6, loop: true, prompt: "A seamless idle animation. Add subtle breathing and small secondary motion while keeping the character's silhouette, outfit, palette, and position consistent.", phases: ["Settle", "Breathe", "Secondary motion", "Return to start"] },
  { id: "walk", label: "Walk", frames: 8, loop: true, prompt: "A continuous walk cycle in place, facing the same direction throughout. Use clear alternating contact and passing poses; keep the character size and baseline consistent for a seamless loop.", phases: ["Right foot contact", "Down pose", "Passing pose", "Up pose", "Left foot contact", "Down pose", "Passing pose", "Return to contact"] },
  { id: "run", label: "Run", frames: 8, loop: true, prompt: "A fast run cycle in place with a forward lean, alternating leg contacts, and coordinated arm swing. Keep the character design, facing, scale, and baseline consistent; loop seamlessly.", phases: ["Right contact", "Airborne", "Left contact", "Airborne", "Right contact", "Airborne", "Left contact", "Return to start"] },
  { id: "jump", label: "Jump", frames: 8, loop: false, prompt: "A complete jump action: crouch, takeoff, clear airborne pose, descent, and landing recovery. Keep the design and facing consistent. This is a one-shot animation.", phases: ["Anticipation crouch", "Takeoff", "Rising", "Peak", "Fall", "Landing", "Impact", "Recovery"] },
  { id: "attack", label: "Attack", frames: 8, loop: false, prompt: "A readable attack action with anticipation, a decisive strike, and recovery. Preserve the same character, weapon, facing, and proportions. This is a one-shot animation.", phases: ["Ready", "Wind-up", "Strike begins", "Impact", "Follow-through", "Recover", "Return to stance", "Hold"] },
  { id: "hurt", label: "Hurt", frames: 4, loop: false, prompt: "A brief hurt reaction: recoil from impact, show a clear readable hit pose, then recover slightly. Preserve character identity and facing. One-shot animation.", phases: ["Impact", "Recoil", "Stagger", "Recover"] },
  { id: "death", label: "Death", frames: 8, loop: false, prompt: "A readable defeat animation that transitions from the current pose into a final fallen pose. Preserve the character design and facing. One-shot animation.", phases: ["Hit", "Stagger", "Lose balance", "Fall", "Impact", "Settle", "Final pose", "Hold"] },
];

const starterSkills: SavedSkill[] = [
  { schemaVersion: 1, id: "skill-walk", name: "Looping walk cycle", category: "animation", promptTemplate: "A readable walk cycle in place for {subject}, facing {direction}. Keep the silhouette, palette, and proportions consistent. Loop cleanly.", defaults: { frameCount: 8, fps: 8, loop: true }, updatedAt: "Built-in" },
  { schemaVersion: 1, id: "skill-pixel-prop", name: "Pixel-art game prop", category: "asset", promptTemplate: "{subject}, crisp pixel art with a limited palette, clear silhouette, transparent background, centered on canvas.", defaults: { size: "64", pixelArt: true, transparentBackground: true }, updatedAt: "Built-in" },
];

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not encode backup image."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read backup image."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string, fallbackType: string): Blob {
  const [metadata, encoded] = dataUrl.split(",", 2);
  if (!metadata || !encoded) throw new Error("Invalid image data in workspace backup.");
  const mime = metadata.match(/^data:([^;]+)/)?.[1] ?? fallbackType;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function normalizeGeneratedImage(source: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image canvas is unavailable.");
  context.imageSmoothingEnabled = false;
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not normalize generated image.")), "image/png"));
}

function makeSlug(name: string, id: string = makeId()) {
  const normalized = name.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${normalized || "item"}-${id.slice(0, 8)}`;
}

function hydrateProjects(value: unknown): StudioProject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && "id" in entry)).map((rawProject) => {
    const project = rawProject as unknown as StudioProject;
    const projectSlug = typeof rawProject.slug === "string" ? rawProject.slug : makeSlug(String(rawProject.name ?? "project"), String(rawProject.id));
    return {
    ...project,
    slug: projectSlug,
    folderPath: typeof rawProject.folderPath === "string" ? rawProject.folderPath : `projects/${projectSlug}`,
    canvasSize: rawProject.size === "custom" ? { width: Number((rawProject.canvasSize as { width?: unknown } | undefined)?.width) || 64, height: Number((rawProject.canvasSize as { height?: unknown } | undefined)?.height) || 64 } : undefined,
    anchorVersions: Array.isArray(rawProject.anchorVersions) ? rawProject.anchorVersions as AnchorVersion[] : [],
    anchorArtMode: rawProject.anchorArtMode === "hd" ? "hd" : "pixel",
    anchorDirection: typeof rawProject.anchorDirection === "string" ? rawProject.anchorDirection as StudioProject["anchorDirection"] : "front",
    anchorPivot: rawProject.anchorPivot && typeof rawProject.anchorPivot === "object" ? rawProject.anchorPivot as { x: number; y: number } : undefined,
    cards: Array.isArray(rawProject.cards) ? (rawProject.cards as Record<string, unknown>[]).map((rawCard) => {
      const card = rawCard as unknown as StudioCard;
      const cardSlug = typeof rawCard.slug === "string" ? rawCard.slug : makeSlug(String(rawCard.name ?? "card"), String(rawCard.id));
      const kind = rawCard.kind === "asset" ? "assets" : "animations";
      const normalizedAssetVersions = Array.isArray(rawCard.assetVersions) ? (rawCard.assetVersions as Array<Record<string, unknown>>).map((version, index) => ({ ...version, number: Number(version.number) > 0 ? Math.floor(Number(version.number)) : index + 1 })) as unknown as StudioCard["assetVersions"] : undefined;
      const normalizedVersions = Array.isArray(rawCard.versions) ? (rawCard.versions as Array<Record<string, unknown>>).map((version, index) => normalizeAnimationVersion(version, index, rawCard.fps)) : undefined;
      const normalizedCardFrames = Array.isArray(rawCard.frames) ? rawCard.frames.map((frame) => normalizeFrameTiming(frame, rawCard.fps) as StudioFrame) : card.frames;
      return {
        ...card,
        slug: cardSlug,
        folderPath: typeof rawCard.folderPath === "string" ? rawCard.folderPath : `projects/${projectSlug}/cards/${kind}/${cardSlug}`,
        frameCount: Number(rawCard.frameCount) > 0 ? Math.floor(Number(rawCard.frameCount)) : undefined,
        fps: Number(rawCard.fps) > 0 ? Math.floor(Number(rawCard.fps)) : undefined,
        frames: normalizedCardFrames,
        versions: normalizedVersions,
        assetVersions: normalizedAssetVersions,
        ...(rawCard.size === "custom" && !rawCard.canvasSize ? { canvasSize: { width: 64, height: 64 } } : {}),
      };
    }) : [],
    skills: Array.isArray(rawProject.skills) ? rawProject.skills as SavedSkill[] : [],
  };
  });
}

function parseSkill(value: unknown): SavedSkill | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedSkill>;
  if (typeof candidate.name !== "string" || typeof candidate.promptTemplate !== "string") return null;
  const categories: SavedSkill["category"][] = ["animation", "asset", "character", "general"];
  const defaults = candidate.defaults && typeof candidate.defaults === "object" ? candidate.defaults : {};
  const size = defaults.size && ["64", "128", "512", "custom"].includes(defaults.size) ? defaults.size : undefined;
  const normalized = {
    schemaVersion: 1,
    id: typeof candidate.id === "string" ? candidate.id : makeId(),
    name: candidate.name,
    category: categories.includes(candidate.category as SavedSkill["category"]) ? candidate.category as SavedSkill["category"] : "general",
    description: typeof candidate.description === "string" ? candidate.description : undefined,
    promptTemplate: candidate.promptTemplate,
    negativePrompt: typeof candidate.negativePrompt === "string" ? candidate.negativePrompt : undefined,
    defaults: {
      ...(size ? { size } : {}),
      ...(typeof defaults.pixelArt === "boolean" ? { pixelArt: defaults.pixelArt } : {}),
      ...(typeof defaults.transparentBackground === "boolean" ? { transparentBackground: defaults.transparentBackground } : {}),
      ...(typeof defaults.frameCount === "number" ? { frameCount: defaults.frameCount } : {}),
      ...(typeof defaults.fps === "number" ? { fps: defaults.fps } : {}),
      ...(typeof defaults.loop === "boolean" ? { loop: defaults.loop } : {}),
    },
    workflowNotes: Array.isArray(candidate.workflowNotes) ? candidate.workflowNotes.filter((note): note is string => typeof note === "string") : [],
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "Imported",
  };
  const parsed = savedSkillSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function renderSkillMarkdown(skills: SavedSkill[]) {
  return ["# Sprite Studio Skills", "", ...skills.flatMap((skill) => [
    `## ${skill.name}`,
    "",
    `<!-- sprite-studio-skill: ${JSON.stringify(skill)} -->`,
    `Category: ${skill.category}`,
    ...(skill.description ? ["", skill.description] : []),
    "",
    "### Prompt template",
    "```text",
    skill.promptTemplate,
    "```",
    ...(skill.negativePrompt ? ["", "### Negative prompt", "```text", skill.negativePrompt, "```"] : []),
    "",
  ])].join("\n");
}

function fillSkillTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => variables[key] ?? `{${key}}`);
}

function skillPlaceholders(template: string) {
  return [...new Set(Array.from(template.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (match) => match[1]))];
}

function parseSkillsMarkdown(markdown: string) {
  const skills: SavedSkill[] = [];
  const metadataPattern = /<!--\s*sprite-studio-skill:\s*(\{[^\n]*\})\s*-->/g;
  for (const match of markdown.matchAll(metadataPattern)) {
    try {
      const skill = parseSkill(JSON.parse(match[1]));
      if (skill) skills.push(skill);
    } catch {
      // Ignore malformed metadata blocks and continue parsing valid skills.
    }
  }
  if (skills.length) return skills;
  const sections = markdown.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const name = section.split("\n")[0]?.trim();
    const prompt = section.match(/### Prompt template\s*```text\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
    const category = section.match(/^Category:\s*(animation|asset|character|general)\s*$/im)?.[1] as SavedSkill["category"] | undefined;
    if (name && prompt) skills.push({ schemaVersion: 1, id: makeId(), name, category: category ?? "general", promptTemplate: prompt, defaults: {}, updatedAt: "Imported" });
  }
  return skills;
}

function App() {
  const [theme, setTheme] = useState<"studio" | "academic">(() => { try { return localStorage.getItem("sprite-studio.theme.v1") === "academic" ? "academic" : "studio"; } catch { return "studio"; } });
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [skills, setSkills] = useState<SavedSkill[]>(starterSkills);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [activeView, setActiveView] = useState<"workspace" | "skills" | "settings">("workspace");
  const [dialog, setDialog] = useState<"project" | "animation" | "asset" | "skill" | null>(null);
  const [editingSkill, setEditingSkill] = useState<SavedSkill | null>(null);
  const [skillImportMessage, setSkillImportMessage] = useState("");
  const [skillFileInput, setSkillFileInput] = useState<HTMLInputElement | null>(null);
  const [draftSkillId, setDraftSkillId] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftAnimationPreset, setDraftAnimationPreset] = useState("custom");
  const [draftFrameCount, setDraftFrameCount] = useState(8);
  const [draftLoop, setDraftLoop] = useState(true);
  const [draftPhases, setDraftPhases] = useState<AnimationPhase[]>([]);
  const [skillVariables, setSkillVariables] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [projectExportOpen, setProjectExportOpen] = useState(false);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [foundationNotice, setFoundationNotice] = useState("");
  const [missingImageKeys, setMissingImageKeys] = useState<string[]>([]);
  const [desktopProjectPath, setDesktopProjectPath] = useState("");
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [providerDraftType, setProviderDraftType] = useState<NonNullable<ProviderProfile["providerType"]>>("openai-compatible");
  const [isGeneratingAnchor, setIsGeneratingAnchor] = useState(false);
  const [generatingCardId, setGeneratingCardId] = useState<string | null>(null);
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const [showGenerationJobs, setShowGenerationJobs] = useState(true);
  const generationJobsRef = useRef<GenerationJob[]>([]);
  const generationControllers = useRef(new Map<string, AbortController>());
  const cancelledGenerationIds = useRef(new Set<string>());
  const generationQueueRef = useRef(Promise.resolve());
  const projectsRef = useRef(projects);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("sprite-studio.theme.v1", theme); } catch { /* Session theme still applies if storage is unavailable. */ }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    async function initializeWorkspace() {
      try {
        const { workspace: saved, jobs: savedJobs } = await loadWorkspaceAndJobs();
      if (saved) {
          if (cancelled) return;
          const parsedProjects = hydrateProjects(saved.projects).filter((project) => studioProjectSchema.safeParse(project).success);
          setProjects(parsedProjects);
          const hydratedSkills = saved.skills.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill));
          setSkills(hydratedSkills.length ? hydratedSkills : starterSkills);
          setActiveProjectId(saved.activeProjectId);
          const providers = saved.providers?.profiles.map((profile) => providerProfileSchema.safeParse(profile)).filter((result) => result.success).map((result) => result.data) ?? [];
          setProviderProfiles(providers);
          setActiveProviderId(saved.providers?.activeProfileId ?? providers[0]?.id ?? null);
          const restoredJobs = savedJobs.map((job) => generationJobSchema.safeParse(job)).filter((result) => result.success).map((result) => result.data);
          setGenerationJobs(restoredJobs.map((job) => job.status === "running" || job.status === "queued" ? { ...job, status: "failed", progress: 0, error: "App closed before the request completed. Retry the job.", updatedAt: new Date().toISOString() } : job));
        } else {
          const legacyProjects = hydrateProjects(JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]")).filter((project) => studioProjectSchema.safeParse(project).success);
          const legacySkillsRaw: unknown = JSON.parse(localStorage.getItem(SKILLS_KEY) ?? "null");
          const legacySkills = Array.isArray(legacySkillsRaw) ? legacySkillsRaw.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill)) : [];
          const activeProject = JSON.parse(localStorage.getItem("sprite-studio.activeProject.v1") ?? "null") as string | null;
          const initial = { schemaVersion: 1 as const, projects: legacyProjects, skills: legacySkills.length ? legacySkills : starterSkills, activeProjectId: activeProject, providers: { profiles: [], activeProfileId: null } };
          await saveWorkspace(initial);
          if (cancelled) return;
          setProjects(legacyProjects);
          setSkills(initial.skills);
          setActiveProjectId(activeProject);
          localStorage.removeItem(PROJECTS_KEY);
          localStorage.removeItem(SKILLS_KEY);
          localStorage.removeItem("sprite-studio.activeProject.v1");
        }
        if (!cancelled) setWorkspaceLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(error instanceof Error ? error.message : "Could not load local workspace.");
          setWorkspaceLoaded(true);
        }
      }
    }
    void initializeWorkspace();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!workspaceLoaded) return;
    const checkedProjects = projects.map((project) => studioProjectSchema.safeParse(project));
    const checkedSkills = skills.map((skill) => savedSkillSchema.safeParse(skill));
    const invalidProject = checkedProjects.find((result) => !result.success);
    const invalidSkill = checkedSkills.find((result) => !result.success);
    if (invalidProject && !invalidProject.success) {
      const issue = invalidProject.error.issues[0];
      setWorkspaceError(`Project data failed validation${issue?.path.length ? ` at ${issue.path.join(".")}` : ""}: ${issue?.message ?? "invalid project"}`);
      return;
    }
    if (invalidSkill && !invalidSkill.success) {
      setWorkspaceError(`Skill data failed validation: ${invalidSkill.error.issues[0]?.message ?? "invalid skill"}`);
      return;
    }
    void Promise.all([
      saveWorkspace({ schemaVersion: WORKSPACE_SCHEMA_VERSION, projects, skills, activeProjectId, providers: { profiles: providerProfiles, activeProfileId: activeProviderId } }),
      saveGenerationJobs(generationJobs),
      syncProjectIndex(projects),
      ...(desktopAvailable() ? [persistDesktopProjects(projects)] : []),
    ]).then(() => setWorkspaceError("")).catch((error: unknown) => {
      setWorkspaceError(error instanceof Error ? error.message : "Could not save local workspace.");
    });
  }, [workspaceLoaded, projects, skills, activeProjectId, providerProfiles, activeProviderId, generationJobs]);

  useEffect(() => {
    if (!workspaceLoaded || !desktopAvailable()) return;
    void desktopProjectsDirectory().then(setDesktopProjectPath).catch((error: unknown) => setWorkspaceError(error instanceof Error ? error.message : "Could not locate the project folder on disk."));
  }, [workspaceLoaded]);

  useEffect(() => { generationJobsRef.current = generationJobs; }, [generationJobs]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);

  useEffect(() => {
    void initializeDatabase().catch((error: unknown) => setWorkspaceError(error instanceof Error ? error.message : "Could not initialize local database."));
  }, []);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeCard = activeProject?.cards.find((card) => card.id === activeCardId) ?? null;
  const projectSkills = activeProject?.skills ?? [];
  const availableSkills = [...skills, ...projectSkills];
  const filteredSkills = useMemo(() => availableSkills.filter((skill) => `${skill.name} ${skill.category} ${skill.projectId ? activeProject?.name ?? "project" : "global"}`.toLowerCase().includes(search.toLowerCase())), [skills, projectSkills, search, activeProject?.name]);

  function showCardDialog(kind: "animation" | "asset") {
    setDraftSkillId("");
    setDraftPrompt("");
    setSkillVariables({});
    setDraftAnimationPreset("custom");
    setDraftFrameCount(8);
    setDraftLoop(true);
    setDraftPhases([]);
    setDialog(kind);
  }

function createProviderDraft(type: NonNullable<ProviderProfile["providerType"]> = "openai-compatible") {
    setActiveProviderId(null);
    setProviderDraftType(type);
    setProviderModels([]);
    setProviderMessage("");
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = makeId();
    const name = String(data.get("name") || "Untitled project").trim();
    const slug = makeSlug(name, id);
    const project: StudioProject = {
      id,
      name,
      slug,
      folderPath: `projects/${slug}`,
      size: String(data.get("size") || "64") as SpriteSize,
      ...(data.get("size") === "custom" ? { canvasSize: { width: Number(data.get("customWidth")) || 64, height: Number(data.get("customHeight")) || 64 } } : {}),
      anchorName: "No anchor image yet",
      cards: [],
      createdAt: new Date().toISOString(),
    };
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setActiveView("workspace");
    setDialog(null);
  }

  function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("size") === "custom") {
      for (const field of ["customWidth", "customHeight"]) {
        const value = Number(data.get(field));
        if (!Number.isInteger(value) || value < 1 || value > 4096) {
          setFoundationNotice("Custom canvas dimensions must be whole numbers between 1 and 4096 pixels.");
          return;
        }
      }
    }
    createProject(event);
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
    const actionPreset = dialog === "animation" ? animationPresets.find((preset) => preset.id === String(data.get("actionPreset") || "custom")) : undefined;
    const poseFile = dialog === "animation" ? data.get("startPose") : data.get("referenceImage");
    const uploadedImageKey = poseFile instanceof File && poseFile.size > 0 ? `${dialog === "animation" ? "pose" : "asset-reference"}-${makeId()}` : undefined;
    if (uploadedImageKey && poseFile instanceof File) await saveImage(uploadedImageKey, poseFile);
    const sizeSelection = String(data.get("cardSize") || "inherit") as SpriteSize | "inherit";
    const explicitSize = sizeSelection === "inherit" ? undefined : sizeSelection;
    const canvasSize = explicitSize === "custom" ? { width: Number(data.get("cardWidth")) || 64, height: Number(data.get("cardHeight")) || 64 } : undefined;
    const id = makeId();
    const name = String(data.get("name") || (dialog === "animation" ? "New animation" : "New asset")).trim();
    const slug = makeSlug(name, id);
    const initialFrameCount = Number(data.get("frameCount")) || actionPreset?.frames || 8;
    const initialFps = Number(data.get("fps")) || 8;
    const shouldLoop = dialog === "animation" ? data.get("loop") === "on" : true;
    const phases = dialog === "animation" ? draftPhases.filter((phase) => phase.label.trim() || phase.prompt.trim()) : [];
    const card: StudioCard = {
      id,
      name,
      slug,
      folderPath: `${activeProject.folderPath}/cards/${dialog === "animation" ? "animations" : "assets"}/${slug}`,
      kind: dialog,
      prompt: fillSkillTemplate(String(data.get("prompt") || actionPreset?.prompt || "").trim(), skillVariables),
      createdAt: new Date().toISOString(),
      ...(dialog === "animation" ? { frameCount: initialFrameCount, fps: initialFps, loop: shouldLoop } : {}),
      ...(dialog === "animation" ? { phases: phases.length ? phases : (actionPreset?.phases ?? []).map((label) => ({ id: makeId(), label, prompt: `${label} pose` })) } : {}),
      ...(activeProject.anchorVersionId ? { anchorVersionId: activeProject.anchorVersionId } : {}),
      ...(dialog === "animation" && uploadedImageKey ? { startPoseImageKey: uploadedImageKey } : {}),
      ...(dialog === "asset" ? {
        ...(uploadedImageKey ? { referenceImageKey: uploadedImageKey } : {}),
        artMode: data.get("artMode") === "hd" ? "hd" as const : "pixel" as const,
        transparentBackground: data.get("transparentBackground") === "on",
        variationCount: Math.max(1, Math.min(8, Number(data.get("variations")) || 1)),
        assetPlacement: { scale: 1, offsetX: 0, offsetY: 0 },
      } : {}),
      ...(explicitSize ? { size: explicitSize } : {}),
      ...(canvasSize ? { canvasSize } : {}),
      ...(appliedSkill ? { skillSnapshot: structuredClone(appliedSkill), fps: appliedSkill.defaults.fps ?? initialFps, loop: appliedSkill.defaults.loop ?? shouldLoop, ...(!explicitSize && appliedSkill.defaults.size ? { size: appliedSkill.defaults.size } : {}), frameCount: appliedSkill.defaults.frameCount ?? initialFrameCount } : {}),
    };
    setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, cards: [card, ...project.cards] } : project));
    setDialog(null);
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
      workflowNotes: String(data.get("notes") || "").split("\n").map((note) => note.trim()).filter(Boolean),
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
    setProjects((current) => current.map((project) => {
      if (project.id !== priorProjectId && project.id !== skill.projectId) return project;
      const remaining = (project.skills ?? []).filter((entry) => entry.id !== skill.id);
      return { ...project, skills: project.id === skill.projectId ? [skill, ...remaining] : remaining };
    }));
    setSkills((current) => {
      const remaining = current.filter((entry) => entry.id !== skill.id);
      return skill.projectId ? remaining : [skill, ...remaining];
    });
    if (priorProjectId !== skill.projectId) setProjects((current) => current.map((project) => {
      if (project.id !== priorProjectId && project.id !== skill.projectId) return project;
      const remaining = (project.skills ?? []).filter((entry) => entry.id !== skill.id);
      return { ...project, skills: project.id === skill.projectId ? [skill, ...remaining] : remaining };
    }));
    setEditingSkill(null);
    setDialog(null);
  }

  function openSkillEditor(skill?: SavedSkill) {
    setEditingSkill(skill ?? null);
    setDialog("skill");
  }

  function duplicateSkill(skill: SavedSkill) {
    const duplicate = { ...structuredClone(skill), id: makeId(), name: `${skill.name} copy`, updatedAt: new Date().toLocaleDateString() };
    if (skill.projectId) setProjects((current) => current.map((project) => project.id === skill.projectId ? { ...project, skills: [duplicate, ...(project.skills ?? [])] } : project));
    else setSkills((current) => [duplicate, ...current]);
  }

  function exportSkills() {
    const payload = { format: "sprite-studio-skills/v1", skills: [...skills, ...projects.flatMap((project) => project.skills ?? [])] };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "sprite-studio-skills.json");
  }

  function exportSkillsMarkdown() {
    downloadBlob(new Blob([renderSkillMarkdown([...skills, ...projects.flatMap((project) => project.skills ?? [])])], { type: "text/markdown" }), "sprite-studio-skills.md");
  }

  async function importSkills(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".md")) {
        const markdownSkills = parseSkillsMarkdown(text);
        if (!markdownSkills.length) throw new Error("No skills found in the Markdown file.");
        setSkills((current) => [...markdownSkills.map((skill) => ({ ...skill, id: makeId(), projectId: undefined, updatedAt: new Date().toLocaleDateString() })), ...current]);
        setSkillImportMessage(`Imported ${markdownSkills.length} skill${markdownSkills.length === 1 ? "" : "s"}.`);
        return;
      }
      const parsed: unknown = JSON.parse(text);
      const payload = parsed as { skills?: unknown[] };
      const entries = Array.isArray(payload.skills) ? payload.skills : Array.isArray(parsed) ? parsed : [parsed];
      const valid = entries.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill));
      if (!valid.length) throw new Error("No valid skills found. Check the skill JSON format.");
      setSkills((current) => [...valid.map((skill) => ({ ...skill, id: makeId(), projectId: undefined, updatedAt: new Date().toLocaleDateString() })), ...current]);
      setSkillImportMessage(`Imported ${valid.length} skill${valid.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setSkillImportMessage(error instanceof Error ? error.message : "Could not import skill file.");
    }
  }

  function deleteSkill(skill: SavedSkill) {
    if (!window.confirm(`Delete “${skill.name}” from your skills library?`)) return;
    if (skill.projectId) setProjects((current) => current.map((project) => project.id === skill.projectId ? { ...project, skills: (project.skills ?? []).filter((entry) => entry.id !== skill.id) } : project));
    else setSkills((current) => current.filter((entry) => entry.id !== skill.id));
  }

  function renameProject(project: StudioProject) {
    const name = window.prompt("Project name", project.name)?.trim();
    if (!name || name === project.name) return;
    const slug = makeSlug(name, project.id);
    setProjects((current) => current.map((item) => item.id === project.id ? {
      ...item,
      name,
      slug,
      folderPath: `projects/${slug}`,
      cards: item.cards.map((card) => ({ ...card, folderPath: `projects/${slug}/cards/${card.kind === "animation" ? "animations" : "assets"}/${card.slug}` })),
    } : item));
  }

  function updateCard(projectId: string, cardId: string, update: (card: StudioCard) => StudioCard) {
    setProjects((current) => current.map((project) => project.id === projectId ? { ...project, cards: project.cards.map((card) => card.id === cardId ? update(card) : card) } : project));
  }

  function renameCard(project: StudioProject, card: StudioCard) {
    const name = window.prompt("Card name", card.name)?.trim();
    if (!name || name === card.name) return;
    applyCardRename(project, card, name);
  }

  function applyCardRename(project: StudioProject, card: StudioCard, name: string) {
    const slug = makeSlug(name, card.id);
    updateCard(project.id, card.id, (current) => ({ ...current, name, slug, folderPath: `${project.folderPath}/cards/${current.kind === "animation" ? "animations" : "assets"}/${slug}` }));
  }

  function duplicateCard(project: StudioProject, card: StudioCard) {
    const id = makeId();
    const slug = makeSlug(`${card.name} copy`, id);
    const duplicate: StudioCard = { ...structuredClone(card), id, name: `${card.name} copy`, slug, folderPath: `${project.folderPath}/cards/${card.kind === "animation" ? "animations" : "assets"}/${slug}`, createdAt: new Date().toISOString(), frames: [], versions: [], activeVersionId: undefined, generatedImageKey: undefined };
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, cards: [duplicate, ...item.cards] } : item));
  }

  function moveCard(project: StudioProject, cardId: string, offset: number) {
    setProjects((current) => current.map((item) => {
      if (item.id !== project.id) return item;
      const index = item.cards.findIndex((card) => card.id === cardId);
      if (index < 0) return item;
      const cardKind = item.cards[index].kind;
      const siblingIndices = item.cards.map((card, cardIndex) => card.kind === cardKind && !card.archivedAt ? cardIndex : -1).filter((cardIndex) => cardIndex >= 0);
      const position = siblingIndices.indexOf(index);
      const targetPosition = Math.max(0, Math.min(siblingIndices.length - 1, position + offset));
      if (position < 0 || targetPosition === position) return item;
      const cards = [...item.cards];
      const targetIndex = siblingIndices[targetPosition];
      [cards[index], cards[targetIndex]] = [cards[targetIndex], cards[index]];
      return { ...item, cards };
    }));
  }

  function archiveCard(project: StudioProject, card: StudioCard) {
    updateCard(project.id, card.id, (current) => ({ ...current, archivedAt: new Date().toISOString() }));
  }

  function restoreCard(project: StudioProject, card: StudioCard) {
    updateCard(project.id, card.id, (current) => { const { archivedAt: _archivedAt, ...restored } = current; return restored; });
  }

  async function deleteCard(project: StudioProject, card: StudioCard) {
    if (!window.confirm(`Permanently delete “${card.name}”?`)) return;
    const imageKeys = new Set<string>();
    if (card.generatedImageKey) imageKeys.add(card.generatedImageKey);
    if (card.startPoseImageKey) imageKeys.add(card.startPoseImageKey);
    if (card.referenceImageKey) imageKeys.add(card.referenceImageKey);
    for (const frame of card.frames ?? []) imageKeys.add(frame.imageKey);
    for (const version of card.versions ?? []) for (const frame of version.frames) imageKeys.add(frame.imageKey);
    for (const version of card.assetVersions ?? []) imageKeys.add(version.imageKey);
    const referencedElsewhere = new Set(project.cards.filter((entry) => entry.id !== card.id).flatMap((entry) => [entry.generatedImageKey, entry.startPoseImageKey, entry.referenceImageKey, ...(entry.frames ?? []).map((frame) => frame.imageKey), ...(entry.versions ?? []).flatMap((version) => version.frames.map((frame) => frame.imageKey)), ...(entry.assetVersions ?? []).map((version) => version.imageKey)].filter((key): key is string => Boolean(key))));
    try {
      await deleteImages([...imageKeys].filter((key) => !referencedElsewhere.has(key)));
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not delete the card's stored images.");
      return;
    }
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, cards: item.cards.filter((entry) => entry.id !== card.id) } : item));
    setGenerationJobs((current) => current.filter((job) => job.cardId !== card.id));
    if (activeCardId === card.id) setActiveCardId(null);
    setFoundationNotice(`Deleted “${card.name}” and its stored images.`);
  }

  function archiveProject(project: StudioProject) {
    if (!window.confirm(`Archive “${project.name}”? You can restore it later.`)) return;
    setProjects((current) => current.map((item) => item.id === project.id ? { ...item, archivedAt: new Date().toISOString() } : item));
    if (activeProjectId === project.id) setActiveProjectId(null);
  }

  function restoreProject(project: StudioProject) {
    setProjects((current) => current.map((item) => {
      if (item.id !== project.id) return item;
      const { archivedAt: _archivedAt, ...restored } = item;
      return restored;
    }));
    setActiveProjectId(project.id);
    setShowArchivedProjects(false);
  }

  function chooseActiveProject() {
    const candidates = projects.filter((project) => !project.archivedAt);
    if (candidates.length === 1) setActiveProjectId(candidates[0].id);
    else {
      const id = window.prompt(`Enter a project number to open:\n${candidates.map((item, index) => `${index + 1}. ${item.name}`).join("\n")}`);
      const selected = candidates[Number(id) - 1];
      if (selected) { setActiveProjectId(selected.id); setActiveView("workspace"); }
    }
  }

  async function exportWorkspaceBackup() {
    try {
      const imageKeys = await listStoredImageKeys();
      const blobs = await loadImages(imageKeys);
      const images: WorkspaceExport["images"] = {};
      await Promise.all(Object.entries(blobs).map(async ([key, blob]) => {
        images[key] = { type: blob.type, data: await blobToDataUrl(blob) };
      }));
      const backup: WorkspaceExport = { format: "sprite-studio-workspace/v1", exportedAt: new Date().toISOString(), projects, skills, images, generationJobs };
      downloadBlob(new Blob([JSON.stringify(backup)], { type: "application/json" }), `sprite-studio-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setFoundationNotice("Workspace backup downloaded.");
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not create workspace backup.");
    }
  }

  async function exportProjectArchive(project: StudioProject) {
    try {
      const archivedProject = structuredClone(project);
      const imageKeys = new Set<string>();
      for (const anchor of project.anchorVersions ?? []) imageKeys.add(anchor.imageKey);
      for (const card of project.cards) {
        if (card.generatedImageKey) imageKeys.add(card.generatedImageKey);
        if (card.startPoseImageKey) imageKeys.add(card.startPoseImageKey);
        if (card.referenceImageKey) imageKeys.add(card.referenceImageKey);
        for (const frame of card.frames ?? []) imageKeys.add(frame.imageKey);
        for (const version of card.versions ?? []) for (const frame of version.frames) imageKeys.add(frame.imageKey);
        for (const version of card.assetVersions ?? []) imageKeys.add(version.imageKey);
      }
      const blobs = await loadImages([...imageKeys]);
      const types: Record<string, string> = {};
      const imageFiles: Record<string, Uint8Array> = {};
      const missing: string[] = [];
      for (const key of imageKeys) {
        const blob = blobs[key];
        if (!blob) { missing.push(key); continue; }
        imageFiles[`images/${encodeURIComponent(key)}`] = new Uint8Array(await blob.arrayBuffer());
        types[key] = blob.type;
      }
      const missingSet = new Set(missing);
      const miss = (key?: string) => key && missingSet.has(key) ? `missing:${key}` : key;
      for (const version of archivedProject.anchorVersions ?? []) version.imageKey = miss(version.imageKey)!;
      for (const card of archivedProject.cards) {
        if (card.generatedImageKey) card.generatedImageKey = miss(card.generatedImageKey);
        if (card.startPoseImageKey) card.startPoseImageKey = miss(card.startPoseImageKey);
        if (card.referenceImageKey) card.referenceImageKey = miss(card.referenceImageKey);
        card.frames = card.frames?.map((frame) => ({ ...frame, imageKey: miss(frame.imageKey)! }));
        card.versions = card.versions?.map((version) => ({ ...version, frames: version.frames.map((frame) => ({ ...frame, imageKey: miss(frame.imageKey)! })) }));
        card.assetVersions = card.assetVersions?.map((version) => ({ ...version, imageKey: miss(version.imageKey)! }));
      }
      const files: Record<string, Uint8Array> = { ...imageFiles, "project.json": new TextEncoder().encode(JSON.stringify(archivedProject, null, 2)) };
      files["images.json"] = new TextEncoder().encode(JSON.stringify(types));
      files["recovery.json"] = new TextEncoder().encode(JSON.stringify(missing));
      if (missing.length) setFoundationNotice(`Exported project archive with ${missing.length} missing image${missing.length === 1 ? "" : "s"} omitted.`);
      else setFoundationNotice(`Project “${project.name}” archived with ${imageKeys.size} images.`);
      downloadBlob(new Blob([zipSync(files)], { type: "application/zip" }), `${safeFilename(project.name)}.sprite-project.zip`);
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not archive the project.");
    }
  }

  async function importProjectArchive(file?: File) {
    if (!file) return;
    try {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer())) as Record<string, Uint8Array>;
      const projectFile = Object.entries(archive).find(([path]) => path.endsWith("/project.json") || path === "project.json");
      if (!projectFile) throw new Error("The archive does not contain a project.json manifest.");
      const project = JSON.parse(new TextDecoder().decode(projectFile[1])) as StudioProject;
      const parsedProject = studioProjectSchema.safeParse(project);
      if (!parsedProject.success) throw new Error("The archive contains invalid project metadata.");
      const imageEntries = Object.entries(archive).filter(([path]) => path.startsWith("images/"));
      const originalMissingKeys = archive["recovery.json"] ? JSON.parse(new TextDecoder().decode(archive["recovery.json"])) as string[] : [];
      const imageTypes = archive["images.json"] ? JSON.parse(new TextDecoder().decode(archive["images.json"])) as Record<string, string> : {};
      const imageKeysByPath = new Map<string, string>();
      for (const [path, bytes] of imageEntries) {
        const key = `archive-${makeId()}`;
        const originalKey = decodeURIComponent(path.slice("images/".length));
        const mime = imageTypes[originalKey] || "image/png";
        await saveImage(key, new Blob([bytes], { type: mime }));
        imageKeysByPath.set(originalKey, key);
      }
      for (const key of originalMissingKeys) if (key.startsWith("missing:") && !imageKeysByPath.has(key.slice("missing:".length))) imageKeysByPath.set(key.slice("missing:".length), key);
      const pathFor = (imageKey: string) => imageKeysByPath.get(imageKey) ?? (imageKey.startsWith("missing:") ? imageKey : `missing:${imageKey}`);
      const nextProject = structuredClone(parsedProject.data);
      for (const card of nextProject.cards) {
        card.slug = makeSlug(card.name, card.id);
        card.frames = (card.frames ?? []).map((frame) => ({ ...frame, imageKey: pathFor(frame.imageKey) }));
        card.versions = card.versions?.map((version) => ({ ...version, frames: version.frames.map((frame) => ({ ...frame, imageKey: pathFor(frame.imageKey) })) }));
        card.assetVersions = card.assetVersions?.map((version) => ({ ...version, imageKey: pathFor(version.imageKey) }));
        if (card.generatedImageKey) card.generatedImageKey = pathFor(card.generatedImageKey);
        if (card.startPoseImageKey) card.startPoseImageKey = pathFor(card.startPoseImageKey);
        if (card.referenceImageKey) card.referenceImageKey = pathFor(card.referenceImageKey);
        card.folderPath = `${project.folderPath}/cards/${card.kind === "animation" ? "animations" : "assets"}/${card.slug}`;
      }
      nextProject.anchorVersions = (nextProject.anchorVersions ?? []).map((version) => ({ ...version, imageKey: pathFor(version.imageKey) }));
      const references = [
        ...(nextProject.anchorVersions ?? []).map((version) => version.imageKey),
        ...nextProject.cards.flatMap((card) => [card.generatedImageKey, card.startPoseImageKey, card.referenceImageKey, ...(card.frames ?? []).map((frame) => frame.imageKey), ...(card.versions ?? []).flatMap((version) => version.frames.map((frame) => frame.imageKey)), ...(card.assetVersions ?? []).map((version) => version.imageKey)].filter((key): key is string => Boolean(key))),
      ];
      const available = new Set(imageKeysByPath.values());
      const missing = [...new Set([...references.filter((key) => key.startsWith("missing:") || !available.has(key)).map((key) => key.startsWith("missing:") ? key : `missing:${key}`), ...originalMissingKeys.map((key) => key.startsWith("missing:") ? key : `missing:${key}`)])];
      const missingNames = new Set(missing.map((key) => key.startsWith("missing:") ? key.slice("missing:".length) : key));
      const validKeys = new Set([...available, ...missing, ...missingNames]);
      const valid = (key?: string) => !key || validKeys.has(key);
      for (const anchor of nextProject.anchorVersions ?? []) if (!valid(anchor.imageKey)) anchor.imageKey = `missing:${anchor.imageKey}`;
      for (const card of nextProject.cards) {
        card.frames = card.frames?.map((frame) => frame.imageKey.startsWith("missing:") || valid(frame.imageKey) ? frame : { ...frame, imageKey: `missing:${frame.imageKey}` });
        card.versions = card.versions?.map((version) => ({ ...version, frames: version.frames.map((frame) => frame.imageKey.startsWith("missing:") || valid(frame.imageKey) ? frame : { ...frame, imageKey: `missing:${frame.imageKey}` }) }));
        card.assetVersions = card.assetVersions?.map((version) => version.imageKey.startsWith("missing:") || valid(version.imageKey) ? version : { ...version, imageKey: `missing:${version.imageKey}` });
        if (card.generatedImageKey && !card.generatedImageKey.startsWith("missing:") && !valid(card.generatedImageKey)) card.generatedImageKey = `missing:${card.generatedImageKey}`;
        if (card.startPoseImageKey && !card.startPoseImageKey.startsWith("missing:") && !valid(card.startPoseImageKey)) card.startPoseImageKey = `missing:${card.startPoseImageKey}`;
        if (card.referenceImageKey && !card.referenceImageKey.startsWith("missing:") && !valid(card.referenceImageKey)) card.referenceImageKey = `missing:${card.referenceImageKey}`;
      }
      setMissingImageKeys(missing);
      if (!studioProjectSchema.safeParse(nextProject).success) throw new Error("Could not recover this project archive's image references.");
      const collision = projects.some((item) => item.id === nextProject.id || item.slug === nextProject.slug);
      if (collision) {
        nextProject.id = makeId();
        nextProject.slug = makeSlug(`${nextProject.name}-imported`, nextProject.id);
        nextProject.folderPath = `projects/${nextProject.slug}`;
        for (const card of nextProject.cards) card.folderPath = `${nextProject.folderPath}/cards/${card.kind === "animation" ? "animations" : "assets"}/${card.slug}`;
      }
      setProjects((current) => [nextProject, ...current]);
      setActiveProjectId(nextProject.id);
      setActiveView("workspace");
      setFoundationNotice(`Imported project “${nextProject.name}” and recovered ${imageKeysByPath.size} images.${missing.length ? ` ${missing.length} files need recovery.` : ""}`);
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not import the project archive.");
    }
  }

  async function recoverMissingImage(key: string, file?: File) {
    if (!file) return;
    const replacement = key.startsWith("missing:") ? key.slice("missing:".length) : key;
    await saveImage(replacement, file);
    if (key.startsWith("missing:")) {
      setProjects((current) => current.map((project) => ({
        ...project,
        anchorVersions: project.anchorVersions?.map((version) => version.imageKey === key || version.imageKey === replacement ? { ...version, imageKey: replacement } : version),
        cards: project.cards.map((card) => ({
          ...card,
          generatedImageKey: card.generatedImageKey === key || card.generatedImageKey === replacement ? replacement : card.generatedImageKey,
          startPoseImageKey: card.startPoseImageKey === key || card.startPoseImageKey === replacement ? replacement : card.startPoseImageKey,
          referenceImageKey: card.referenceImageKey === key || card.referenceImageKey === replacement ? replacement : card.referenceImageKey,
          frames: card.frames?.map((frame) => frame.imageKey === key || frame.imageKey === replacement ? { ...frame, imageKey: replacement } : frame),
          versions: card.versions?.map((version) => ({ ...version, frames: version.frames.map((frame) => frame.imageKey === key || frame.imageKey === replacement ? { ...frame, imageKey: replacement } : frame) })),
          assetVersions: card.assetVersions?.map((version) => version.imageKey === key || version.imageKey === replacement ? { ...version, imageKey: replacement } : version),
        })),
      })));
    }
    setMissingImageKeys((current) => current.filter((item) => item !== key));
    setFoundationNotice(`Recovered image “${file.name}”.`);
  }

  async function restoreWorkspaceBackup(file?: File) {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validation = workspaceExportSchema.safeParse(parsed);
      if (!validation.success || !isWorkspaceExport(parsed)) throw new Error("This file is not a valid Sprite Studio workspace backup.");
      const backup = validation.data;
      if (!window.confirm(`Restore ${backup.projects.length} projects and ${Object.keys(backup.images).length} images? This will replace the current workspace.`)) return;
      await clearWorkspaceData();
      await saveGenerationJobs([]);
      for (const [key, image] of Object.entries(backup.images)) await saveImage(key, dataUrlToBlob(image.data, image.type));
      const nextProjects = hydrateProjects(backup.projects).filter((project) => studioProjectSchema.safeParse(project).success);
      const nextSkills = backup.skills.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill));
      const nextJobs = (backup.generationJobs ?? []).map((job) => job.status === "running" || job.status === "queued" ? { ...job, status: "failed" as const, progress: 0, error: "Restored from backup before the request completed. Retry this job.", updatedAt: new Date().toISOString() } : job);
      const next = { schemaVersion: WORKSPACE_SCHEMA_VERSION, projects: nextProjects, skills: nextSkills, activeProjectId: nextProjects.find((project) => !project.archivedAt)?.id ?? null, generationJobs: nextJobs };
      await saveWorkspace(next);
      await saveGenerationJobs(nextJobs);
      setProjects(nextProjects);
      setSkills(nextSkills);
      setActiveProjectId(next.activeProjectId);
      setGenerationJobs(nextJobs);
      setShowArchivedProjects(false);
      setFoundationNotice("Workspace restored from backup.");
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not restore this workspace backup.");
    }
  }

  async function chooseProjectDirectory() {
    if (window.__TAURI_INTERNALS__) {
      try {
        const [{ open }, { join }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/api/path")]);
        const selected = await open({ directory: true, multiple: false, title: "Choose a folder for Sprite Studio projects" });
        if (typeof selected !== "string") return;
        const root = await join(selected, "SpriteStudioProjects");
        for (const project of projects) {
          const keys = [...(project.anchorVersions ?? []).map((version) => version.imageKey), ...project.cards.flatMap((card) => [...(card.frames ?? []).map((frame) => frame.imageKey), ...(card.startPoseImageKey ? [card.startPoseImageKey] : [])])];
          const activeAnchorKey = project.anchorVersions?.find((version) => version.id === project.anchorVersionId)?.imageKey;
          const activeAnchorBlob = activeAnchorKey ? (await loadImages([activeAnchorKey]))[activeAnchorKey] : undefined;
          const anchorBlob = activeAnchorBlob ?? (project.anchorPreview ? await fetch(project.anchorPreview).then((response) => response.blob()) : undefined);
          await writeDesktopProject(root, project, await loadImages(keys), anchorBlob);
        }
        setFoundationNotice(`Wrote ${projects.length} project folder${projects.length === 1 ? "" : "s"} to ${root}.`);
      } catch (error) {
        setFoundationNotice(error instanceof Error ? error.message : "Could not write project folders.");
      }
      return;
    }
    const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: "readwrite" }) => Promise<WritableDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      setFoundationNotice("Folder export needs a browser with the File System Access API. Download a workspace backup for portable recovery.");
      return;
    }
    try {
      const parent = await picker({ mode: "readwrite" });
      for (const project of projects) {
        const destination = await parent.getDirectoryHandle(project.slug, { create: true });
        const keys = [...(project.anchorVersions ?? []).map((version) => version.imageKey), ...project.cards.flatMap((card) => [...(card.frames ?? []).map((frame) => frame.imageKey), ...(card.generatedImageKey ? [card.generatedImageKey] : []), ...(card.startPoseImageKey ? [card.startPoseImageKey] : [])])];
        const activeAnchorKey = project.anchorVersions?.find((version) => version.id === project.anchorVersionId)?.imageKey;
        const activeAnchorBlob = activeAnchorKey ? (await loadImages([activeAnchorKey]))[activeAnchorKey] : undefined;
        const anchorBlob = activeAnchorBlob ?? (project.anchorPreview ? await fetch(project.anchorPreview).then((response) => response.blob()) : undefined);
        await writeDirectory(destination, project, await loadImages(keys), anchorBlob);
      }
      setFoundationNotice(`Wrote ${projects.length} project folder${projects.length === 1 ? "" : "s"} to the selected location.`);
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not write project folders.");
    }
  }

  function saveCardAsSkill(card: StudioCard, settings: { fps: number; loop: boolean; frameCount: number; size?: SpriteSize }) {
    const name = window.prompt("Name this reusable skill", `${card.name} recipe`);
    if (!name?.trim()) return;
    const skill: SavedSkill = {
      schemaVersion: 1,
      id: makeId(),
      name: name.trim(),
      category: card.kind,
      description: `Saved from the ${card.name} card.`,
      promptTemplate: card.prompt,
      defaults: { fps: settings.fps, loop: settings.loop, frameCount: settings.frameCount, ...(settings.size ? { size: settings.size } : {}) },
      projectId: activeProject?.id,
      updatedAt: new Date().toLocaleDateString(),
    };
    if (activeProject) setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, skills: [skill, ...(project.skills ?? [])] } : project));
    else setSkills((current) => [skill, ...current]);
  }

  function updateAnchor(file?: File) {
    if (!activeProject || !file) return;
    const imageKey = `anchor-${makeId()}`;
    void saveImage(imageKey, file).then(async () => {
      const preview = await blobToDataUrl(file);
      setProjects((current) => current.map((project) => {
        if (project.id !== activeProject.id) return project;
        const version: AnchorVersion = { id: makeId(), imageKey, name: file.name, source: "upload", artMode: project.anchorArtMode ?? "pixel", direction: project.anchorDirection ?? "front", pivot: project.anchorPivot, createdAt: new Date().toISOString() };
        return { ...project, anchorName: version.name, anchorVersionId: version.id, anchorVersions: [...(project.anchorVersions ?? []), version], anchorPreview: preview, anchorArtMode: version.artMode, anchorDirection: version.direction, anchorPivot: version.pivot };
      }));
    }).catch((error: unknown) => setFoundationNotice(error instanceof Error ? error.message : "Could not save anchor image."));
  }

  function updateAnchorMetadata(projectId: string, field: "artMode" | "direction" | "pivot", value: string | { x: number; y: number }) {
    setProjects((current) => current.map((project) => {
      if (project.id !== projectId) return project;
      const patch = field === "artMode" ? { anchorArtMode: value as "pixel" | "hd" } : field === "direction" ? { anchorDirection: value as NonNullable<StudioProject["anchorDirection"]> } : { anchorPivot: value as { x: number; y: number } };
      const versions = (project.anchorVersions ?? []).map((version) => version.id !== project.anchorVersionId ? version : {
        ...version,
        ...(field === "artMode" ? { artMode: value as "pixel" | "hd" } : {}),
        ...(field === "direction" ? { direction: value as NonNullable<AnchorVersion["direction"]> } : {}),
        ...(field === "pivot" ? { pivot: value as { x: number; y: number } } : {}),
      });
      return { ...project, ...patch, anchorVersions: versions };
    }));
  }

  const activeProvider = providerProfiles.find((profile) => profile.id === activeProviderId) ?? null;

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = String(data.get("id") || makeId());
    const existing = providerProfiles.find((profile) => profile.id === id);
    const secret = String(data.get("apiKey") || "").trim();
    const providerType = String(data.get("providerType") || "openai-compatible") as NonNullable<ProviderProfile["providerType"]>;
    const imageToImage = providerType === "grok" || data.get("imageToImage") === "on";
    const transparency = data.get("transparency") === "on";
    let normalizedBaseUrl: string;
    try {
      const url = new URL(String(data.get("baseUrl") || "").trim());
      if (!url.hostname || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Provider URL must use HTTPS except for localhost.");
      normalizedBaseUrl = url.toString().replace(/\/+$/, "");
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter a valid provider URL.");
      return;
    }
    const profile = providerProfileSchema.parse({
      id,
      name: String(data.get("name") || "OpenAI-compatible provider").trim(),
      providerType,
      baseUrl: normalizedBaseUrl,
      model: String(data.get("model") || "").trim(),
      quality: String(data.get("quality") || "auto") as NonNullable<ProviderProfile["quality"]>,
      apiKeyConfigured: Boolean(secret || existing?.apiKeyConfigured),
      capabilities: { modelsList: existing?.capabilities?.modelsList ?? false, textToImage: true, imageToImage, transparency },
      updatedAt: new Date().toISOString(),
    });
    if (secret) await saveProviderSecret(id, secret);
    else if (existing && !window.__TAURI_INTERNALS__) {
      try { await getProviderSecret(id); }
      catch {
        setProviderMessage("Enter an API key for this browser session before saving the provider.");
        return;
      }
    }
    const profileWithSecret = { ...profile, apiKeyConfigured: profile.apiKeyConfigured || Boolean(secret) };
    setProviderProfiles((current) => [profileWithSecret, ...current.filter((item) => item.id !== id)]);
    setActiveProviderId(id);
    setProviderModels([]);
    setProviderMessage(secret ? "Provider profile and credential saved." : "Provider profile saved.");
  }

  async function testActiveProvider() {
    if (!activeProvider) return;
    setProviderBusy(true);
    if (activeProvider.providerType === "parley" || activeProvider.providerType === "grok") {
      try {
        await getProviderSecret(activeProvider.id);
        setProviderMessage(`${activeProvider.providerType === "parley" ? "Parley" : "xAI Grok"} API key is available. The first image request will verify the connection.`);
      } catch (error) {
        setProviderMessage(error instanceof Error ? error.message : "API key is unavailable.");
      } finally {
        setProviderBusy(false);
      }
      return;
    }
    setProviderMessage("Testing connection…");
    try {
      await getProviderSecret(activeProvider.id);
      const result = await testProviderConnection(activeProvider);
      setProviderModels(result.models);
      if (!result.modelsList) {
        const updated = { ...activeProvider, capabilities: { modelsList: false, textToImage: true, imageToImage: false, transparency: false } };
        setProviderProfiles((current) => current.map((profile) => profile.id === updated.id ? updated : profile));
        setProviderMessage("Parley profile is ready. Its supplied API documentation does not include a models-list endpoint, so the first generation request will verify the connection.");
        return;
      }
      const updated = { ...activeProvider, capabilities: { ...(activeProvider.capabilities ?? { textToImage: true, imageToImage: false, transparency: false, modelsList: false }), modelsList: true } };
      setProviderProfiles((current) => current.map((profile) => profile.id === updated.id ? updated : profile));
      setProviderMessage(result.models.length ? `Connected. Found ${result.models.length} models.` : "Endpoint responded; no model list was returned.");
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Provider connection failed.");
    } finally {
      setProviderBusy(false);
    }
  }

  async function deleteActiveProvider() {
    if (!activeProvider || !window.confirm(`Remove provider “${activeProvider.name}” and its saved credential?`)) return;
    try { await removeProviderSecret(activeProvider.id); } catch { /* Missing key is already deleted. */ }
    setProviderProfiles((current) => current.filter((profile) => profile.id !== activeProvider.id));
    setActiveProviderId(providerProfiles.find((profile) => profile.id !== activeProvider.id)?.id ?? null);
    setProviderModels([]);
    setProviderMessage("Provider removed.");
  }

  async function generateAssetForCard(card: StudioCard) {
    if (!activeProject || !activeProvider) return;
    try {
      await getProviderSecret(activeProvider.id);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter the provider API key before generating.");
      setActiveView("settings");
      setFoundationNotice("Add the API key to the selected provider. In browser mode it is kept for this session only.");
      return;
    }
    const usingReference = Boolean(card.anchorVersionId ?? activeProject.anchorVersionId);
    if (!window.confirm(`Generate “${card.name}” with ${activeProvider.name} / ${activeProvider.model}?${usingReference ? " The selected anchor image will be sent as a reference." : ""} This sends a request to the provider and may incur charges.`)) return;
    const dimensions = resolveCardCanvas(activeProject, card);
    const anchorKey = card.startPoseImageKey ?? activeProject.anchorVersions?.find((version) => version.id === (card.anchorVersionId ?? activeProject.anchorVersionId))?.imageKey;
    const anchorVersionId = card.anchorVersionId ?? activeProject.anchorVersionId;
    const referenceImageKey = card.referenceImageKey ?? anchorKey;
    const variations = Math.max(1, Math.min(8, card.variationCount ?? 1));
    const batchId = makeId();
    const appliedSkill = card.skillSnapshot;
    const promptTemplate = appliedSkill?.promptTemplate ?? card.prompt;
    const resolvedPrompt = promptTemplate.replaceAll("{subject}", card.name).replaceAll("{style}", card.artMode === "hd" ? "smooth HD illustration" : "crisp pixel art").replaceAll("{motion}", "standalone game asset");
    const prompt = `${resolvedPrompt}\n\nArt direction: ${card.artMode === "hd" ? "smooth detailed HD 2D art" : "crisp pixel art with a limited palette"}. ${card.transparentBackground === false ? "Use a simple solid background." : "Use a transparent background."} Generate variation {variation} of ${variations}. Keep the asset isolated, centered, and readable.`;
    for (let index = 0; index < variations; index++) {
      const job = makeGenerationJob({ project: activeProject, provider: activeProvider, card, prompt: prompt.replace("{variation}", `${index + 1}/${variations}`), dimensions, target: "asset", referenceImageKey, anchorVersionId, batchId, versionId: batchId, variationIndex: index });
      await enqueueGeneration(job);
    }
  }

  async function generateAnimationCard(card: StudioCard) {
    if (!activeProject || !activeProvider) return;
    const phases = card.phases ?? [];
    if (!phases.length) { setFoundationNotice("Add animation phases before generating frames."); return; }
    try {
      await getProviderSecret(activeProvider.id);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Enter the provider API key before generating.");
      setActiveView("settings");
      setFoundationNotice("Add the API key to the selected provider. In browser mode it is kept for this session only.");
      return;
    }
    if (!window.confirm(`Generate ${phases.length} frames for “${card.name}” with ${activeProvider.name}? Each frame is a separate image request and may incur charges.`)) return;
    const dimensions = resolveCardCanvas(activeProject, card);
    const anchorVersionId = card.anchorVersionId ?? activeProject.anchorVersionId;
    const referenceImageKey = card.startPoseImageKey ?? activeProject.anchorVersions?.find((version) => version.id === anchorVersionId)?.imageKey;
    const batchId = makeId();
    const completedPhaseIndices = new Set<number>();
    const version: AnimationVersion = { id: batchId, number: (card.versions?.length ?? 0) + 1, createdAt: new Date().toISOString(), prompt: card.prompt, phases, frames: [], fps: card.fps ?? 8, loop: card.loop ?? true, size: card.size ?? activeProject.size, canvasSize: card.canvasSize, anchorVersionId };
    updateCard(activeProject.id, card.id, (current) => ({ ...current, versions: [...(current.versions ?? []), version], activeVersionId: version.id, frames: [] }));
    const promptTemplate = card.skillSnapshot?.promptTemplate ?? card.prompt;
    const resolvedPrompt = promptTemplate.replaceAll("{subject}", card.name).replaceAll("{style}", "consistent game sprite art").replaceAll("{motion}", phases.map((phase) => phase.label).join(", "));
    const jobs = phases.map((phase, frameIndex) => makeGenerationJob({ project: activeProject, provider: activeProvider, card, prompt: `${resolvedPrompt}\n\nFrame ${frameIndex + 1}/${phases.length}: ${phase.label}. ${phase.prompt}\n\nKeep the established character design, scale, facing, palette, and background consistent with the reference image.`, dimensions, target: "animation-frame", referenceImageKey, anchorVersionId, frameIndex, phaseId: phase.id, batchId, versionId: batchId })).filter((job) => !completedPhaseIndices.has(job.frameIndex!));
    if (!jobs.length) { setFoundationNotice("All planned animation phases already have generated frames."); return; }
    setGenerationJobs((current) => [...jobs, ...current]);
    for (const job of jobs) {
      if (cancelledGenerationIds.current.has(job.id)) continue;
      const succeeded = await runGeneration(job);
      if (!succeeded) {
        const stoppedAt = jobs.findIndex((item) => item.id === job.id);
        const skipped = new Set(jobs.slice(stoppedAt + 1).map((item) => item.id));
        setGenerationJobs((current) => current.map((item) => skipped.has(item.id) && (item.status === "queued" || item.status === "running") ? {
          ...item,
          status: "cancelled",
          progress: 0,
          error: "Skipped because an earlier frame in this animation failed. Retry to generate this frame.",
          updatedAt: new Date().toISOString(),
        } : item));
        break;
      }
    }
  }

  function makeGenerationJob(args: { project: StudioProject; provider: ProviderProfile; card?: StudioCard; prompt: string; dimensions: CanvasSize; target: "anchor" | "asset" | "animation-frame"; referenceImageKey?: string; anchorVersionId?: string; frameIndex?: number; phaseId?: string; batchId?: string; versionId?: string; variationIndex?: number }): GenerationJob {
    const now = new Date().toISOString();
    return {
      id: args.batchId ? `${args.batchId}-${String(args.frameIndex ?? args.variationIndex ?? 0).padStart(3, "0")}` : makeId(), projectId: args.project.id, cardId: args.card?.id, providerProfileId: args.provider.id, anchorVersionId: args.anchorVersionId, frameIndex: args.frameIndex, phaseId: args.phaseId, batchId: args.batchId, versionId: args.versionId, variationIndex: args.variationIndex, skillSnapshot: args.card?.skillSnapshot ? structuredClone(args.card.skillSnapshot) : undefined,
      target: args.target, status: "queued", progress: 0, createdAt: now, updatedAt: now,
      request: { prompt: args.prompt, width: args.dimensions.width, height: args.dimensions.height, referenceAssetIds: [], referenceImageKey: args.referenceImageKey, transparentBackground: args.card?.kind === "asset" ? args.card.transparentBackground ?? true : true, pixelArt: args.card?.kind === "asset" ? args.card.artMode !== "hd" : true },
    };
  }

  async function enqueueGeneration(job: GenerationJob) {
    setGenerationJobs((current) => [job, ...current]);
    generationQueueRef.current = generationQueueRef.current.catch(() => undefined).then(async () => {
      if (cancelledGenerationIds.current.has(job.id)) return;
      await runGeneration(job);
    });
  }

  async function runGeneration(original: GenerationJob): Promise<boolean> {
    const controller = new AbortController();
    generationControllers.current.set(original.id, controller);
    const provider = providerProfiles.find((profile) => profile.id === original.providerProfileId);
    const project = projects.find((item) => item.id === original.projectId);
    if (!provider || !project) {
      setGenerationJobs((current) => current.map((item) => item.id === original.id ? { ...item, status: "failed", error: "Provider profile or project is unavailable.", updatedAt: new Date().toISOString() } : item));
      generationControllers.current.delete(original.id);
      return false;
    }
    const job = { ...original, status: "running" as const, progress: 10, error: undefined, updatedAt: new Date().toISOString() };
    setGenerationJobs((current) => current.map((item) => item.id === job.id ? job : item));
    if (job.target === "anchor") setIsGeneratingAnchor(true);
    if (job.cardId) setGeneratingCardId(job.cardId);
    try {
      const reference = job.request.referenceImageKey ? await loadImage(job.request.referenceImageKey) : undefined;
      if (reference && provider.capabilities?.imageToImage === false) throw new Error("This provider is configured for text-to-image only. Enable image edits in provider settings or choose a reference-capable provider.");
      setGenerationJobs((current) => current.map((item) => item.id === job.id ? { ...job, progress: 35, updatedAt: new Date().toISOString() } : item));
      const result = await withTimeout(generateImage(provider, { prompt: job.request.prompt, width: job.request.width, height: job.request.height, transparentBackground: job.request.transparentBackground, quality: provider.quality ?? "auto", referenceImage: reference, signal: controller.signal }), controller, 180_000);
      setGenerationJobs((current) => current.map((item) => item.id === job.id ? { ...job, progress: 82, updatedAt: new Date().toISOString() } : item));
      const outputImageKey = `generated-${job.id}`;
      const blob = await normalizeGeneratedImage(result.blob, job.request.width, job.request.height);
      await saveImage(outputImageKey, blob);
      setProjects((current) => current.map((item) => {
        if (item.id !== job.projectId) return item;
        if (job.target === "anchor") {
          const version: AnchorVersion = { id: makeId(), imageKey: outputImageKey, name: `Anchor v${(item.anchorVersions?.length ?? 0) + 1}`, source: "generated", prompt: job.request.prompt, artMode: item.anchorArtMode ?? "pixel", direction: item.anchorDirection ?? "front", pivot: item.anchorPivot, createdAt: new Date().toISOString() };
          return { ...item, anchorVersionId: version.id, anchorVersions: [...(item.anchorVersions ?? []), version], anchorName: version.name, anchorPrompt: job.request.prompt, anchorPreview: "" };
        }
        return { ...item, cards: item.cards.map((card) => {
          if (card.id !== job.cardId) return card;
          if (job.target === "animation-frame") {
            const phase = card.phases?.find((entry) => entry.id === job.phaseId);
            const frame: StudioFrame = { id: makeId(), imageKey: outputImageKey, name: phase?.label ?? `Frame ${(job.frameIndex ?? 0) + 1}`, phaseId: job.phaseId, phaseIndex: job.frameIndex, offsetX: 0, offsetY: 0, pivotX: job.request.width / 2, pivotY: job.request.height * .9, durationMs: Math.round(1000 / Math.max(card.fps ?? 8, 1)) };
            const versionFrames = card.versions?.find((version) => version.id === job.versionId)?.frames ?? [];
            const nextFrames = [...versionFrames, frame].sort((left, right) => (left.phaseIndex ?? 999) - (right.phaseIndex ?? 999));
            const versions = (card.versions ?? []).map((version) => version.id === job.versionId ? { ...version, frames: nextFrames } : version);
            return { ...card, frames: job.versionId === card.activeVersionId ? nextFrames : card.frames, versions, anchorVersionId: job.anchorVersionId ?? card.anchorVersionId };
          }
           const assetVersion: AssetVersion = { id: makeId(), number: (card.assetVersions?.length ?? 0) + 1, imageKey: outputImageKey, prompt: job.request.prompt, createdAt: new Date().toISOString() };
           return { ...card, generatedImageKey: outputImageKey, assetVersions: [...(card.assetVersions ?? []), assetVersion], activeAssetVersionId: assetVersion.id, anchorVersionId: job.anchorVersionId ?? card.anchorVersionId };
        }) };
      }));
      setGenerationJobs((current) => current.map((item) => item.id === job.id ? { ...job, status: "succeeded", progress: 100, outputImageKey, updatedAt: new Date().toISOString() } : item));
      if (job.target === "anchor") setFoundationNotice("Anchor generation complete.");
      return true;
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      setGenerationJobs((current) => current.map((item) => item.id === job.id ? { ...job, status: cancelled ? "cancelled" : "failed", progress: 0, error: error instanceof Error ? error.message : "Generation failed.", updatedAt: new Date().toISOString() } : item));
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
      return await Promise.race([operation, new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => { controller.abort(); reject(new Error("Provider request timed out after 3 minutes.")); }, timeoutMs);
      })]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  function cancelGeneration(jobId: string) {
    const running = generationControllers.current.get(jobId);
    if (running) running.abort();
    else {
      cancelledGenerationIds.current.add(jobId);
      setGenerationJobs((current) => current.map((job) => job.id === jobId && job.status === "queued" ? { ...job, status: "cancelled", updatedAt: new Date().toISOString() } : job));
    }
  }

  function retryGeneration(job: GenerationJob) {
    if (job.batchId) {
      const project = projectsRef.current.find((item) => item.id === job.projectId);
      const card = project?.cards.find((item) => item.id === job.cardId);
      const provider = providerProfiles.find((item) => item.id === job.providerProfileId);
      if (!project || !card || !provider) return;
      const phases = card.phases ?? [];
      const activeFrames = card.versions?.find((version) => version.id === card.activeVersionId)?.frames ?? card.frames ?? [];
      const completed = new Set(activeFrames.map((frame) => frame.phaseIndex));
      const batchId = makeId();
      const dimensions = resolveCardCanvas(project, card);
      const versionId = makeId();
      const sourceVersion = card.versions?.find((item) => item.id === card.activeVersionId);
      const version: AnimationVersion = { id: versionId, number: (card.versions?.length ?? 0) + 1, createdAt: new Date().toISOString(), prompt: sourceVersion?.prompt ?? card.prompt, phases, frames: structuredClone(activeFrames), fps: sourceVersion?.fps ?? card.fps ?? 8, loop: sourceVersion?.loop ?? card.loop ?? true, size: sourceVersion?.size ?? card.size ?? project.size, canvasSize: sourceVersion?.canvasSize ?? card.canvasSize, anchorVersionId: sourceVersion?.anchorVersionId ?? card.anchorVersionId };
      updateCard(project.id, card.id, (current) => ({ ...current, frames: version.frames, versions: [...(current.versions ?? []), version], activeVersionId: versionId }));
      const retries = phases.map((phase, frameIndex) => makeGenerationJob({ project, provider, card, prompt: `${card.prompt}\n\nFrame ${frameIndex + 1}/${phases.length}: ${phase.label}. ${phase.prompt}\n\nKeep character identity, scale, facing, palette, and background consistent.`, dimensions, target: "animation-frame", referenceImageKey: card.startPoseImageKey ?? project.anchorVersions?.find((version) => version.id === card.anchorVersionId)?.imageKey, anchorVersionId: card.anchorVersionId, frameIndex, phaseId: phase.id, batchId, versionId })).filter((item) => !completed.has(item.frameIndex));
       if (retries.length) {
         setGenerationJobs((current) => [...retries, ...current]);
         generationQueueRef.current = generationQueueRef.current.catch(() => undefined).then(async () => {
           for (const [index, retry] of retries.entries()) {
             if (await runGeneration(retry) === false) {
               const skippedIds = new Set(retries.slice(index + 1).map((item) => item.id));
               setGenerationJobs((current) => current.map((item) => skippedIds.has(item.id) && (item.status === "queued" || item.status === "running") ? { ...item, status: "cancelled", progress: 0, error: "Skipped because an earlier frame in this retry failed.", updatedAt: new Date().toISOString() } : item));
               break;
             }
           }
         });
       }
      return;
    }
    const retry = { ...job, id: makeId(), status: "queued" as const, progress: 0, error: undefined, outputImageKey: undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setGenerationJobs((current) => [retry, ...current]);
    void enqueueGeneration(retry);
  }

  function selectAnchorVersion(projectId: string, version: AnchorVersion) {
    setProjects((current) => current.map((project) => project.id === projectId ? { ...project, anchorVersionId: version.id, anchorName: version.name, anchorPrompt: version.prompt, anchorArtMode: version.artMode, anchorDirection: version.direction, anchorPivot: version.pivot, anchorPreview: "", cards: project.cards.map((card) => card.anchorVersionId === undefined && !card.generatedImageKey ? { ...card, anchorVersionId: version.id } : card) } : project));
  }

  function selectAnimationVersion(projectId: string, cardId: string, version: AnimationVersion) {
    const safeVersion = normalizeAnimationVersion(version as unknown as Record<string, unknown>, Math.max(0, version.number - 1), undefined);
    updateCard(projectId, cardId, (card) => ({ ...card, activeVersionId: safeVersion.id, prompt: safeVersion.prompt, phases: safeVersion.phases, frames: safeVersion.frames, fps: safeVersion.fps, loop: safeVersion.loop, size: safeVersion.size, canvasSize: safeVersion.canvasSize, anchorVersionId: safeVersion.anchorVersionId }));
  }

  function updateAnimationVersion(projectId: string, cardId: string, update: (version: AnimationVersion) => AnimationVersion) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    const card = project?.cards.find((item) => item.id === cardId);
    if (!project || !card) return;
    const source = card.versions?.find((version) => version.id === card.activeVersionId);
    const base: AnimationVersion = source ?? { id: makeId(), number: (card.versions?.length ?? 0) + 1, createdAt: new Date().toISOString(), prompt: card.prompt, phases: card.phases ?? [], frames: card.frames ?? [], fps: card.fps ?? 8, loop: card.loop ?? true, size: card.size ?? project.size, canvasSize: card.canvasSize, anchorVersionId: card.anchorVersionId };
    const updated = update(structuredClone(base));
    const version = source ? updated : base;
    updateCard(projectId, cardId, (current) => ({ ...current, prompt: version.prompt, phases: version.phases, frames: version.frames, fps: version.fps, loop: version.loop, versions: source ? current.versions?.map((entry) => entry.id === version.id ? version : entry) : [...(current.versions ?? []), version], activeVersionId: version.id }));
  }

  function saveCardFrames(cardId: string, frames: StudioFrame[], fps: number, loop: boolean) {
    const safeFps = Number.isFinite(fps) && fps > 0 ? Math.max(1, Math.floor(fps)) : 8;
    const safeFrames = frames.map((frame) => normalizeFrameTiming(frame, safeFps) as StudioFrame);
    setProjects((current) => current.map((project) => ({
      ...project,
      cards: project.cards.map((card) => {
        if (card.id !== cardId) return card;
        const changed = JSON.stringify(card.frames ?? []) !== JSON.stringify(safeFrames) || card.fps !== safeFps || card.loop !== loop;
        if (!changed) return card;
        const activeVersionId = card.activeVersionId;
        if (!activeVersionId) return { ...card, frames: safeFrames, fps: safeFps, loop };
        const currentVersion = card.versions?.find((version) => version.id === activeVersionId);
        if (!currentVersion || JSON.stringify(currentVersion.frames) === JSON.stringify(safeFrames)) return { ...card, frames: safeFrames, fps: safeFps, loop };
        const updatedVersion = { ...structuredClone(currentVersion), frames: safeFrames, fps: safeFps, loop };
        return { ...card, frames: safeFrames, fps: safeFps, loop, versions: card.versions?.map((version) => version.id === activeVersionId ? updatedVersion : version) };
      }),
    })));
  }

  function saveCardPromptAndPhases(cardId: string, prompt: string, phases: AnimationPhase[]) {
    if (!activeProjectId) return;
    updateAnimationVersion(activeProjectId, cardId, (version) => ({ ...version, prompt, phases }));
  }

  function savePreparedPose(cardId: string, file?: File) {
    if (!activeProject || !file) return;
    const imageKey = `pose-${makeId()}`;
    void saveImage(imageKey, file).then(() => updateCard(activeProject.id, cardId, (card) => ({ ...card, startPoseImageKey: imageKey })));
  }

  async function editAnchorImage(prompt: string) {
    if (!activeProject || !activeProvider || !activeProject.anchorVersionId) return;
    if (!activeProvider.capabilities?.imageToImage) {
      setFoundationNotice("Enable image edits in provider settings or choose a provider with image-to-image support.");
      return;
    }
    const currentVersion = activeProject.anchorVersions?.find((version) => version.id === activeProject.anchorVersionId);
    const source = currentVersion ? await loadImage(currentVersion.imageKey) : activeProject.anchorPreview ? dataUrlToBlob(activeProject.anchorPreview, "image/png") : undefined;
    if (!source) { setFoundationNotice("The selected anchor image could not be loaded."); return; }
    if (!window.confirm(`Create a new anchor version by editing the current anchor with ${activeProvider.name}? This may incur charges.`)) return;
    if (!window.confirm(`Create a new anchor version by editing the current anchor with ${activeProvider.name}? This may incur charges.`)) return;
    const dimensions = normalizedCanvas(activeProject.size, activeProject.canvasSize);
    const job = makeGenerationJob({ project: activeProject, provider: activeProvider, prompt, dimensions, target: "anchor", referenceImageKey: currentVersion?.imageKey ?? `anchor-edit-${makeId()}` });
    if (!currentVersion?.imageKey) await saveImage(job.request.referenceImageKey!, source);
    await enqueueGeneration(job);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setActiveView("workspace"); }}>
          <span className="brand-mark">✳</span><span>sprite<span className="brand-light">studio</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={activeView === "workspace" ? "nav-item selected" : "nav-item"} onClick={() => setActiveView("workspace")}><span>▦</span> Projects <span className="nav-count">{projects.length}</span></button>
          <button className={activeView === "skills" ? "nav-item selected" : "nav-item"} onClick={() => setActiveView("skills")}><span>✧</span> Skills library <span className="nav-count">{skills.length}</span></button>
        </nav>
        <div className="sidebar-section">
          <div className="section-label">RECENT PROJECTS <button aria-label="Create project" onClick={() => setDialog("project")}>＋</button></div>
          {projects.filter((project) => !project.archivedAt).length === 0 ? <p className="sidebar-empty">Your projects will appear here.</p> : projects.filter((project) => !project.archivedAt).slice(0, 6).map((project) => (
            <button key={project.id} className={`project-link ${project.id === activeProjectId ? "active" : ""}`} onClick={() => { setActiveProjectId(project.id); setActiveView("workspace"); }}><span className="project-dot" />{project.name}</button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className={activeView === "settings" ? "nav-item selected" : "nav-item"} onClick={() => setActiveView("settings")}><span>⚙</span> Settings</button>
          <div className="local-status"><span className="status-dot" /> Local workspace <span className="local-badge">LOCAL</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeView === "skills" ? "Skills library" : activeView === "settings" ? "Settings" : activeProject?.name ?? "Projects"}</strong></div>
          <div className="topbar-actions"><span className="provider-chip"><span className={`provider-indicator ${activeProvider ? "configured" : ""}`} /> {activeProvider?.name ?? "Provider not configured"}</span><button className="avatar" aria-label="User profile">S</button></div>
        </header>

        {workspaceError && <div className="workspace-notice" role="status">Local workspace: {workspaceError}</div>}
        {foundationNotice && <div className="workspace-notice" role="status">{foundationNotice}</div>}
        {activeView === "settings" && desktopProjectPath && <div className="disk-save-location"><strong>Desktop project storage</strong><span>Generated images and project files save automatically to</span><code>{desktopProjectPath}/&lt;project-slug&gt;</code></div>}
        {activeView === "settings" && <ThemeSettings theme={theme} onChange={setTheme} />}
        {!workspaceLoaded ? <div className="workspace-loading">Loading local workspace…</div> : activeView === "workspace" && (activeCard && activeProject ? activeCard.kind === "asset" ? <StillAssetEditor
          key={activeCard.id}
          card={activeCard}
          canvasSize={resolveCardCanvas(activeProject, activeCard)}
          onClose={() => setActiveCardId(null)}
          onUpdate={(update) => updateCard(activeProject.id, activeCard.id, (current) => ({ ...current, ...update }))}
          onGenerate={() => void generateAssetForCard(activeCard)}
          generating={generatingCardId === activeCard.id}
        /> : <FrameEditor
          key={activeCard.id}
          card={activeCard}
          canvasSize={resolveCardCanvas(activeProject, activeCard)}
          onClose={() => setActiveCardId(null)}
          onSave={(frames, fps, loop) => saveCardFrames(activeCard.id, frames, fps, loop)}
          onSaveAsSkill={(settings) => saveCardAsSkill(activeCard, { ...settings, size: activeCard.size ?? activeProject.size })}
          onSaveCardSettings={(settings) => {
            if (settings.phases) updateAnimationVersion(activeProject.id, activeCard.id, (version) => ({ ...version, phases: settings.phases! }));
            updateCard(activeProject.id, activeCard.id, (card) => ({ ...card, ...settings }));
          }}
          onSavePromptAndPhases={(prompt, phases) => saveCardPromptAndPhases(activeCard.id, prompt, phases)}
          onSavePreparedPose={(file) => savePreparedPose(activeCard.id, file)}
          onRename={(name) => applyCardRename(activeProject, activeCard, name)}
           onGenerateAnimation={() => void generateAnimationCard(activeCard)}
           onSelectVersion={(version) => selectAnimationVersion(activeProject.id, activeCard.id, version)}
           onDelete={() => void deleteCard(activeProject, activeCard)}
        /> : <Workspace
          projects={projects} project={activeProject} onCreateProject={() => setDialog("project")}
          onSelectProject={(id) => { setActiveProjectId(id); setActiveCardId(null); }} onChooseProject={chooseActiveProject} onCreateCard={showCardDialog} onAnchor={updateAnchor}
          onOpenCard={setActiveCardId}
          onProjectExport={() => setProjectExportOpen(true)}
          onRenameProject={renameProject} onArchiveProject={archiveProject} onRestoreProject={restoreProject}
          archivedProjects={projects.filter((project) => Boolean(project.archivedAt))} showArchived={showArchivedProjects} onToggleArchived={() => setShowArchivedProjects((value) => !value)}
          onGenerateAnchor={(prompt) => activeProject && activeProvider && window.confirm(`Generate an anchor with ${activeProvider.name} / ${activeProvider.model}? This may incur charges.`) && void enqueueGeneration(makeGenerationJob({ project: activeProject, provider: activeProvider, prompt: `${prompt}\n\nArt direction: ${activeProject.anchorArtMode === "hd" ? "Detailed HD 2D art" : "Crisp pixel art"}, ${activeProject.anchorDirection ?? "front"} view. Transparent background. Preserve a clear readable silhouette.`, dimensions: normalizedCanvas(activeProject.size, activeProject.canvasSize), target: "anchor" }))} onEditAnchor={editAnchorImage} isGeneratingAnchor={isGeneratingAnchor}
          onSelectAnchorVersion={(version) => activeProject && selectAnchorVersion(activeProject.id, version)}
          onUpdateAnchorMetadata={(field, value) => activeProject && updateAnchorMetadata(activeProject.id, field, value)}
          onGenerateAsset={(card) => void generateAssetForCard(card)} generatingCardId={generatingCardId} providerConfigured={Boolean(activeProvider?.apiKeyConfigured)}
          onGenerateAnimation={(card) => void generateAnimationCard(card)}
          onRenameCard={renameCard} onDuplicateCard={duplicateCard} onMoveCard={moveCard} onArchiveCard={archiveCard} onRestoreCard={restoreCard} onDeleteCard={deleteCard}
        />)}
        {activeView === "workspace" && showGenerationJobs && generationJobs.length > 0 && <GenerationJobPanel jobs={generationJobs} onCancel={cancelGeneration} onRetry={retryGeneration} onClose={() => setShowGenerationJobs(false)} />}
        {activeView === "workspace" && !showGenerationJobs && generationJobs.length > 0 && <button className="show-generation-jobs" onClick={() => setShowGenerationJobs(true)}>Show generation jobs <span>{generationJobs.filter((job) => job.status === "running" || job.status === "queued").length} active</span></button>}
        {activeView === "workspace" && !activeProject && !activeCard && <div className="workspace-project-picker"><h2>Choose a project</h2>{projects.filter((project) => !project.archivedAt).map((project) => <button key={project.id} onClick={() => setActiveProjectId(project.id)}>{project.name}<span>{project.cards.length} cards</span></button>)}</div>}
        {activeView === "skills" && <section className="content-page">
          <div className="page-heading"><div><div className="eyebrow">PROMPT RECIPES</div><h1>Skills library</h1><p>Reusable prompt templates and generation settings, ready for any project.</p></div><div className="skills-page-actions"><input ref={setSkillFileInput} type="file" accept="application/json,.json,text/markdown,.md" className="hidden-file" onChange={(event) => { void importSkills(event.target.files?.[0]); event.currentTarget.value = ""; }} /><div className="skill-export-menu"><button className="button secondary" onClick={exportSkills}>Export JSON</button><button className="button secondary" onClick={exportSkillsMarkdown}>Export Markdown</button><button className="button secondary" onClick={() => skillFileInput?.click()}>Import</button></div><button className="button primary" onClick={() => openSkillEditor()}><span>＋</span> Create skill</button></div></div>
          {activeProject && <div className="skill-scope-tabs"><span>Showing skills for:</span><strong>{activeProject.name}</strong><span>and Global</span></div>}
          <div className="toolbar"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search skills" /></label><span className="result-count">{filteredSkills.length} skills</span></div>
          {skillImportMessage && <p className="skill-import-message" role="status">{skillImportMessage}</p>}
          <div className="skill-grid">{filteredSkills.map((skill) => <article className="skill-card" key={skill.id}><div className="skill-card-top"><span className="skill-icon">✧</span><span className="tag">{skill.projectId ? "project" : "global"}</span><span className="tag">{skill.category}</span></div><h3>{skill.name}</h3><p>{skill.description || skill.promptTemplate}</p><div className="skill-defaults">{skill.defaults.size && <span>{skill.defaults.size} px</span>}{skill.defaults.fps && <span>{skill.defaults.fps} FPS</span>}{skill.defaults.frameCount && <span>{skill.defaults.frameCount} frames</span>}{skill.defaults.loop !== undefined && <span>{skill.defaults.loop ? "Loop" : "One-shot"}</span>}</div><div className="skill-card-footer"><span>Updated {skill.updatedAt}</span><div className="skill-actions"><button onClick={() => openSkillEditor(skill)}>Edit</button><button onClick={() => duplicateSkill(skill)}>Duplicate</button><button onClick={() => deleteSkill(skill)}>Delete</button></div></div></article>)}
            {filteredSkills.length === 0 && <div className="empty-state small-empty"><span className="empty-icon">✧</span><h3>No skills found</h3><p>Try a different search or create a reusable prompt skill.</p></div>}</div>
        </section>}
        {activeView === "settings" && <section className="content-page settings-page"><div className="settings-page-heading"><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p className="page-intro">Configure generation providers and manage your local workspace.</p></div><ProviderSettingsPanel profiles={providerProfiles} activeProfile={activeProvider} activeProfileId={activeProviderId} draftType={providerDraftType} models={providerModels} busy={providerBusy} message={providerMessage} onChoose={(id) => { setActiveProviderId(id); setProviderModels([]); setProviderMessage(""); }} onSave={(event) => void saveProvider(event)} onTest={() => void testActiveProvider()} onDelete={() => void deleteActiveProvider()} onNew={createProviderDraft} /><div className="settings-panel"><div className="settings-icon">▧</div><div><h3>Default sprite size</h3><p>New projects start at 64 × 64. Project sizes can be 64, 128, 512, or custom.</p></div><span className="tag">64 × 64</span></div><div className="foundation-panel"><div><div className="eyebrow">LOCAL WORKSPACE</div><h3>Backup and project folders</h3><p>Export a portable workspace backup including project metadata and imported frame images, restore a backup, or write project folders to a selected directory.</p></div><div className="foundation-actions"><button className="button secondary" onClick={() => void exportWorkspaceBackup()}>Download backup</button><label className="button secondary backup-import">Restore backup<input type="file" accept="application/json,.json" onChange={(event) => { void restoreWorkspaceBackup(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label className="button secondary backup-import">Import project archive<input type="file" accept=".zip,.sprite-project.zip,application/zip" onChange={(event) => { void importProjectArchive(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button className="button secondary" onClick={() => activeProject && void exportProjectArchive(activeProject)} disabled={!activeProject}>Archive current project</button><button className="button secondary" onClick={() => void chooseProjectDirectory()}>Write project folders</button></div></div>{missingImageKeys.length > 0 && <div className="missing-images-panel"><strong>Missing files ({missingImageKeys.length})</strong>{missingImageKeys.map((key) => <label key={key}>{key.slice(0, 44)}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void recoverMissingImage(key, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>)}</div>}{foundationNotice && <p className="foundation-notice" role="status">{foundationNotice}</p>}</section>}
      </main>

      {dialog && <Dialog title={dialog === "project" ? "Create a project" : dialog === "skill" ? "Create a reusable skill" : dialog === "animation" ? "New animation card" : "New asset card"} onClose={() => setDialog(null)}>
        {dialog === "project" && <form onSubmit={handleCreateProject}><label>Project name<input name="name" placeholder="e.g. Mosswood adventure" required autoFocus /></label><CanvasSizeFields name="size" label="Default sprite size" defaultValue="64" /><p className="form-note">You can add an anchor image after creating your project.</p><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button primary">Create project</button></div></form>}
        {(dialog === "animation" || dialog === "asset") && <form onSubmit={createCard}>
          <label>{dialog === "animation" ? "Animation name" : "Asset name"}<input name="name" placeholder={dialog === "animation" ? "e.g. Walk cycle" : "e.g. Iron sword"} required autoFocus /></label>
          {dialog === "animation" && <>
            <label>Action preset<select name="actionPreset" value={draftAnimationPreset} onChange={(event) => {
              const preset = animationPresets.find((item) => item.id === event.target.value) ?? animationPresets[0];
              setDraftAnimationPreset(preset.id);
              setDraftPrompt(preset.prompt);
              setDraftFrameCount(preset.frames);
              setDraftLoop(preset.loop);
              setDraftPhases(preset.phases.map((label) => ({ id: makeId(), label, prompt: `${label} pose` })));
            }}>{animationPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
            <div className="phase-planner"><div className="phase-planner-heading"><strong>Animation phases</strong><button type="button" className="text-button" onClick={() => setDraftPhases((phases) => [...phases, { id: makeId(), label: `Phase ${phases.length + 1}`, prompt: "Describe this key pose" }])}>＋ Add phase</button></div><small>Describe the pose/action for each generated frame. Frames generate in this order.</small>{draftPhases.map((phase, index) => <div className="phase-row" key={phase.id}><span>{String(index + 1).padStart(2, "0")}</span><input aria-label={`Phase ${index + 1} label`} value={phase.label} onChange={(event) => setDraftPhases((phases) => phases.map((item) => item.id === phase.id ? { ...item, label: event.target.value } : item))} /><input aria-label={`Phase ${index + 1} prompt`} value={phase.prompt} onChange={(event) => setDraftPhases((phases) => phases.map((item) => item.id === phase.id ? { ...item, prompt: event.target.value } : item))} /><button type="button" aria-label={`Remove phase ${index + 1}`} onClick={() => setDraftPhases((phases) => phases.filter((item) => item.id !== phase.id))}>×</button></div>)}</div>
            <div className="animation-settings-fields">
              <label>Initial frame count<input name="frameCount" type="number" min="1" max="64" value={draftFrameCount} onChange={(event) => setDraftFrameCount(Math.max(1, Number(event.target.value) || 1))} /></label>
              <label>Playback FPS<input name="fps" type="number" min="1" max="60" defaultValue="8" /></label>
              <label className="animation-loop-option"><input type="checkbox" name="loop" checked={draftLoop} onChange={(event) => setDraftLoop(event.target.checked)} /> Loop animation</label>
            </div>
            {draftSkillId && availableSkills.find((skill) => skill.id === draftSkillId)?.defaults.frameCount && <p className="skill-setting-hint">Selected skill default: {availableSkills.find((skill) => skill.id === draftSkillId)?.defaults.frameCount} frames, {availableSkills.find((skill) => skill.id === draftSkillId)?.defaults.fps ?? 8} FPS.</p>}
           <label className="pose-upload-field">Prepared start pose (optional)<input type="file" name="startPose" accept="image/png,image/jpeg,image/webp" /><small>Use a pose matching the first moment of the action. Without one, the project anchor is used.</small></label>
           </>}
           {dialog === "asset" && <div className="asset-card-settings"><label>Art mode<select name="artMode" defaultValue="pixel"><option value="pixel">Pixel art</option><option value="hd">Smooth / HD</option></select></label><label>Variations<select name="variations" defaultValue="1">{[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="asset-transparency"><input type="checkbox" name="transparentBackground" defaultChecked /> Transparent background</label><label className="pose-upload-field">Reference image (optional)<input type="file" name="referenceImage" accept="image/png,image/jpeg,image/webp" /><small>Use this image as a reference for generated variations.</small></label></div>}
          <CanvasSizeFields name="cardSize" label="Canvas size" defaultValue="inherit" inheritedLabel={`Inherit project (${activeProject?.size === "custom" ? `${activeProject.canvasSize?.width ?? 64} × ${activeProject.canvasSize?.height ?? 64}` : `${activeProject?.size ?? 64} × ${activeProject?.size ?? 64}`})`} />
          <label>Apply a skill<select name="skillId" value={draftSkillId} onChange={(event) => {
            const skill = availableSkills.find((item) => item.id === event.target.value);
            setDraftSkillId(event.target.value);
            setDraftPrompt(skill?.promptTemplate ?? "");
            setSkillVariables({});
          }}><option value="">No skill</option>{availableSkills.filter((skill) => skill.category === "general" || skill.category === dialog || skill.category === "character").map((skill) => <option key={skill.id} value={skill.id}>{skill.name}{skill.projectId ? " · project" : " · global"}</option>)}</select></label>
          {draftSkillId && skillPlaceholders(draftPrompt).length > 0 && <div className="skill-variable-fields">{skillPlaceholders(draftPrompt).map((placeholder) => <label key={placeholder}>{placeholder.replaceAll("_", " ")}<input value={skillVariables[placeholder] ?? ""} onChange={(event) => setSkillVariables((current) => ({ ...current, [placeholder]: event.target.value }))} placeholder={`Value for ${placeholder}`} /></label>)}</div>}
          <label>Prompt<textarea name="prompt" value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} placeholder={dialog === "animation" ? "Describe the motion, what stays consistent, and whether it loops…" : "Describe the asset, style, palette, and background…"} rows={4} /></label>
          <div className="form-note">Animation settings can be changed later in the card editor. Skill placeholders can be filled above or left in the prompt.</div>
          <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="button primary">Create {dialog} card</button></div>
        </form>}
        {dialog === "skill" && <SkillForm key={editingSkill?.id ?? "new-skill"} skill={editingSkill} activeProject={activeProject} onSubmit={saveSkill} onCancel={() => { setEditingSkill(null); setDialog(null); }} />}
      </Dialog>}
      {projectExportOpen && activeProject && <ProjectExportDialog project={activeProject} onClose={() => setProjectExportOpen(false)} />}
    </div>
  );
}

function Workspace({ projects, project, onCreateProject, onChooseProject, onCreateCard, onAnchor, onOpenCard, onProjectExport, onRenameProject, onArchiveProject, onRestoreProject, archivedProjects, showArchived, onToggleArchived, onGenerateAnchor, onEditAnchor, isGeneratingAnchor, onGenerateAsset, onGenerateAnimation, generatingCardId, providerConfigured, onSelectAnchorVersion, onUpdateAnchorMetadata, onRenameCard, onDuplicateCard, onMoveCard, onArchiveCard, onRestoreCard, onDeleteCard }: {
  projects: StudioProject[]; project: StudioProject | null; onCreateProject: () => void;
  onSelectProject: (id: string) => void; onCreateCard: (kind: CardKind) => void; onAnchor: (file?: File) => void;
  onChooseProject: () => void;
  onOpenCard: (id: string) => void;
  onProjectExport: () => void;
  onRenameProject: (project: StudioProject) => void;
  onArchiveProject: (project: StudioProject) => void;
  onRestoreProject: (project: StudioProject) => void;
  archivedProjects: StudioProject[];
  showArchived: boolean;
  onToggleArchived: () => void;
  onGenerateAnchor: (prompt: string) => void;
  onEditAnchor: (prompt: string) => void;
  isGeneratingAnchor: boolean;
  onGenerateAsset: (card: StudioCard) => void;
  onGenerateAnimation: (card: StudioCard) => void;
  generatingCardId: string | null;
  providerConfigured: boolean;
  onSelectAnchorVersion: (version: AnchorVersion) => void;
  onUpdateAnchorMetadata: (field: "artMode" | "direction" | "pivot", value: string | { x: number; y: number }) => void;
  onRenameCard: (project: StudioProject, card: StudioCard) => void;
  onDuplicateCard: (project: StudioProject, card: StudioCard) => void;
  onMoveCard: (project: StudioProject, cardId: string, offset: number) => void;
  onArchiveCard: (project: StudioProject, card: StudioCard) => void;
  onRestoreCard: (project: StudioProject, card: StudioCard) => void;
  onDeleteCard: (project: StudioProject, card: StudioCard) => void;
}) {
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  async function exportAssetSheet(assets: StudioCard[], size: CanvasSize) {
    if (!assets.length) return;
    const columns = Math.ceil(Math.sqrt(assets.length));
    const rows = Math.ceil(assets.length / columns);
    const sheet = document.createElement("canvas");
    sheet.width = columns * size.width;
    sheet.height = rows * size.height;
    const context = sheet.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    try {
      for (const [index, asset] of assets.entries()) {
        if (!asset.generatedImageKey) continue;
        const blob = await loadImage(asset.generatedImageKey);
        if (!blob) continue;
        const image = new Image();
        image.src = URL.createObjectURL(blob);
        await image.decode();
        const cell = document.createElement("canvas");
        renderStillAsset(cell, image, size, asset.assetCrop, asset.assetPlacement ?? { scale: 1, offsetX: 0, offsetY: 0 });
        context.drawImage(cell, (index % columns) * size.width, Math.floor(index / columns) * size.height);
        URL.revokeObjectURL(image.src);
      }
      downloadBlob(await canvasPng(sheet), "project-assets.png");
    } catch {
      return;
    }
  }
  if (!project) return <><section className="welcome-page"><div className="welcome-glow" /><div className="welcome-content"><div className="welcome-icon">✳</div><div className="eyebrow">YOUR LOCAL GAME ART WORKSPACE</div><h1>Make a world.<br /><span>One sprite at a time.</span></h1><p>Organize characters, animations, and game assets in projects you own. Start with a visual anchor, then build a consistent library around it.</p><div className="welcome-actions"><button className="button primary large" onClick={onCreateProject}><span>＋</span> Create a project</button>{projects.some((item) => !item.archivedAt) && <button className="button secondary large" onClick={onChooseProject}>Open a project</button>}</div><div className="welcome-hints"><span><i>01</i> Create a project</span><span><i>02</i> Add an anchor</span><span><i>03</i> Build animation cards</span></div></div><div className="welcome-art"><div className="pixel-star star-one">✦</div><div className="pixel-star star-two">✧</div><div className="pixel-creature"><div className="creature-ear left"/><div className="creature-ear right"/><div className="creature-body"><i className="eye left-eye"/><i className="eye right-eye"/><i className="cheek"/></div><div className="creature-foot left-foot"/><div className="creature-foot right-foot"/></div><div className="art-caption"><span className="status-dot"/> YOUR NEXT CHARACTER STARTS HERE</div></div></section>{archivedProjects.length > 0 && <div className="archived-empty-list"><h2>Archived projects</h2>{archivedProjects.map((archived) => <div key={archived.id}><span>{archived.name}</span><button className="text-button" onClick={() => onRestoreProject(archived)}>Restore</button></div>)}</div>}</>;

  const activeAnimations = project.cards.filter((card) => card.kind === "animation" && !card.archivedAt);
  const archivedAnimations = project.cards.filter((card) => card.kind === "animation" && card.archivedAt);
  const activeAssets = project.cards.filter((card) => card.kind === "asset" && !card.archivedAt);
   const archivedAssets = project.cards.filter((card) => card.kind === "asset" && card.archivedAt);
   const selectedAssetCards = activeAssets.filter((card) => selectedAssetIds.includes(card.id) && card.generatedImageKey);
  const activeCanvas = normalizedCanvas(project.size, project.canvasSize);
  return <section className="project-page">
    <div className="page-heading project-heading"><div><div className="eyebrow">PROJECT WORKSPACE</div><h1>{project.name}</h1><p>Anchor your art direction, then create a set of matching sprites and animations.</p></div><div className="project-header-actions"><button className="button secondary" onClick={() => onRenameProject(project)}>Rename</button><button className="button secondary" onClick={() => onArchiveProject(project)}>Archive</button></div></div>
    <article className="anchor-panel"><div className="anchor-preview"><AnchorPreview imageKey={project.anchorVersions?.find((version) => version.id === project.anchorVersionId)?.imageKey} dataUrl={project.anchorPreview} name={project.anchorName} /></div><div className="anchor-details"><div className="eyebrow">CANONICAL VISUAL REFERENCE</div><h2>{project.anchorName}</h2><p>{project.anchorPrompt || "Upload a reference or generate an anchor. Existing cards stay pinned to their original anchor version."}</p><div className="anchor-actions"><label className="button secondary upload-button">↑ Upload anchor<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onAnchor(event.target.files?.[0])} /></label><button className="text-button" onClick={() => { const prompt = window.prompt("Describe the anchor image to generate"); if (prompt?.trim()) onGenerateAnchor(prompt.trim()); }} disabled={!providerConfigured || isGeneratingAnchor}>{isGeneratingAnchor ? "Generating…" : "Generate anchor"}</button><button className="text-button" onClick={() => { const prompt = window.prompt("Describe how to edit the current anchor"); if (prompt?.trim()) onEditAnchor(prompt.trim()); }} disabled={!providerConfigured || !project.anchorVersionId}>Edit anchor ↗</button></div><div className="anchor-art-settings"><ArtModePicker value={project.anchorArtMode ?? "pixel"} onChange={(value) => onUpdateAnchorMetadata("artMode", value)} /><ViewDirectionPicker value={project.anchorDirection ?? "front"} onChange={(value) => onUpdateAnchorMetadata("direction", value)} /></div><div className="anchor-pivot-controls"><button type="button" className="pivot-reset-button" onClick={() => onUpdateAnchorMetadata("pivot", { x: Math.round(activeCanvas.width / 2), y: Math.round(activeCanvas.height * .9) })} title={`Reset pivot to ${Math.round(activeCanvas.width / 2)}, ${Math.round(activeCanvas.height * .9)}`}>Default pivot <small>Reset</small></button><label>X<input aria-label="Pivot X position" type="number" value={project.anchorPivot?.x ?? Math.round(activeCanvas.width / 2)} onChange={(event) => onUpdateAnchorMetadata("pivot", { x: Number(event.target.value), y: project.anchorPivot?.y ?? Math.round(activeCanvas.height * .9) })} /></label><label>Y<input aria-label="Pivot Y position" type="number" value={project.anchorPivot?.y ?? Math.round(activeCanvas.height * .9)} onChange={(event) => onUpdateAnchorMetadata("pivot", { x: project.anchorPivot?.x ?? Math.round(activeCanvas.width / 2), y: Number(event.target.value) })} /></label></div></div><div className="size-pill"><span>PROJECT CANVAS</span><strong>{activeCanvas.width} × {activeCanvas.height}</strong></div></article>
    {(project.anchorVersions?.length ?? 0) > 0 && <div className="anchor-version-strip"><span>Anchor versions</span>{project.anchorVersions?.map((version, index) => <button key={version.id} className={version.id === project.anchorVersionId ? "anchor-version active" : "anchor-version"} aria-pressed={version.id === project.anchorVersionId} onClick={() => onSelectAnchorVersion(version)}><AnchorPreview imageKey={version.imageKey} name={version.name} /><strong>v{index + 1}{version.id === project.anchorVersionId ? " · current" : ""}</strong><small>{version.name}</small></button>)}</div>}
    <div className="cards-section"><div className="section-heading"><div><div className="eyebrow">MOTION LIBRARY</div><h2>Animation cards <span className="sub-count">{activeAnimations.length}</span></h2></div><button className="button secondary" onClick={() => onCreateCard("animation")}><span>＋</span> New animation</button></div>
      {activeAnimations.length === 0 ? <div className="empty-card-row"><div className="empty-card-symbol">◌</div><div><strong>Your animation set starts here</strong><p>Create an idle, walk, or custom motion card. Each animation keeps its frames and sprite sheet organized.</p></div><button className="text-button" onClick={() => onCreateCard("animation")}>Create animation <span>→</span></button></div> : <div className="card-grid">{activeAnimations.map((card, index) => <CardTile key={card.id} card={card} size={project.size} onOpen={() => onOpenCard(card.id)} onGenerate={providerConfigured ? () => onGenerateAnimation(card) : undefined} actions={[{ label: "Rename", run: () => onRenameCard(project, card) }, { label: "Duplicate", run: () => onDuplicateCard(project, card) }, { label: "Move up", run: () => onMoveCard(project, card.id, -1), disabled: index === 0 }, { label: "Move down", run: () => onMoveCard(project, card.id, 1), disabled: index === activeAnimations.length - 1 }, { label: "Archive", run: () => onArchiveCard(project, card) }, { label: "Delete", run: () => onDeleteCard(project, card) }]} />)}<button className="add-card-tile" onClick={() => onCreateCard("animation")}><span>＋</span><strong>Add animation</strong></button></div>}
      {archivedAnimations.length > 0 && <div className="archived-cards"><strong>Archived animations</strong>{archivedAnimations.map((card) => <div key={card.id}><span>{card.name}</span><button className="text-button" onClick={() => onRestoreCard(project, card)}>Restore</button><button className="text-button destructive" onClick={() => onDeleteCard(project, card)}>Delete</button></div>)}</div>}
    </div>
     <div className="cards-section asset-section"><div className="section-heading"><div><div className="eyebrow">PROJECT ASSETS</div><h2>Assets <span className="sub-count">{activeAssets.length}</span></h2></div><div className="asset-section-actions"><button className="button secondary" disabled={!selectedAssetCards.length} onClick={() => void exportAssetSheet(selectedAssetCards, activeCanvas)}>Export selected sheet</button><button className="button secondary" onClick={() => onCreateCard("asset")}><span>＋</span> New asset</button></div></div>
       {activeAssets.length === 0 ? <div className="empty-card-row asset-empty"><div className="empty-card-symbol">◇</div><div><strong>Add props, icons, and other game assets</strong><p>Keep standalone generated art grouped in this project alongside the character animations.</p></div><button className="text-button" onClick={() => onCreateCard("asset")}>Create asset <span>→</span></button></div> : <div className="card-grid">{activeAssets.map((card) => <div className="asset-card-wrap" key={card.id}><label className="asset-sheet-select"><input aria-label={`Include ${card.name} in asset sheet`} type="checkbox" checked={selectedAssetIds.includes(card.id)} onChange={(event) => setSelectedAssetIds((current) => event.target.checked ? [...current, card.id] : current.filter((id) => id !== card.id))} /> Include in sheet</label><CardTile card={card} size={project.size} onOpen={() => onOpenCard(card.id)} onGenerate={providerConfigured ? () => onGenerateAsset(card) : undefined} generating={generatingCardId === card.id} actions={[{ label: "Rename", run: () => onRenameCard(project, card) }, { label: "Duplicate", run: () => onDuplicateCard(project, card) }, { label: "Archive", run: () => onArchiveCard(project, card) }, { label: "Delete", run: () => onDeleteCard(project, card) }]} /></div>)}<button className="add-card-tile" onClick={() => onCreateCard("asset")}><span>＋</span><strong>Add asset</strong></button></div>}
      {archivedAssets.length > 0 && <div className="archived-cards"><strong>Archived assets</strong>{archivedAssets.map((card) => <div key={card.id}><span>{card.name}</span><button className="text-button" onClick={() => onRestoreCard(project, card)}>Restore</button><button className="text-button destructive" onClick={() => onDeleteCard(project, card)}>Delete</button></div>)}</div>}
    </div>
    <div className="project-footer"><span>{project.folderPath}</span><div><button onClick={onToggleArchived}>{showArchived ? "Hide archived" : `Archived projects (${archivedProjects.length})`}</button><button onClick={onProjectExport}>Combined project export <span>↗</span></button></div></div>
    {showArchived && <div className="archived-projects">{archivedProjects.length ? archivedProjects.map((archived) => <div key={archived.id}><span>{archived.name}</span><button className="text-button" onClick={() => onRestoreProject(archived)}>Restore</button></div>) : <p>No archived projects.</p>}</div>}
  </section>;
}

function CardTile({ card, size, onOpen, onGenerate, generating, actions = [] }: { card: StudioCard; size: SpriteSize; onOpen?: () => void; onGenerate?: () => void; generating?: boolean; actions?: Array<{ label: string; run: () => void; disabled?: boolean }> }) {
  const dimensions = normalizedCanvas(card.size ?? size, card.canvasSize);
  const sizeLabel = `${dimensions.width} × ${dimensions.height}`;
  const deleteAction = actions.find((action) => action.label === "Delete");
  return <article className="card-tile clickable-card"><div className="card-art-wrap"><button className="card-open-target" onClick={onOpen} aria-label={`Open ${card.name}`}><div className="card-art">{card.generatedImageKey ? <GeneratedAssetPreview imageKey={card.generatedImageKey} name={card.name} /> : <div className="card-art-grid"><span>{card.kind === "animation" ? "◌" : "◇"}</span></div>}<span className={`card-kind ${card.kind}`}>{card.kind}</span></div></button>{deleteAction && <button type="button" className="card-direct-delete" aria-label={`Delete ${card.name}`} title={`Delete ${card.name}`} onClick={(event) => { event.stopPropagation(); deleteAction.run(); }}>×</button>}</div><div className="card-tile-info"><div><h3>{card.name}</h3><p>{card.prompt || (card.kind === "animation" ? "Add a motion prompt" : "Add an asset prompt")}</p></div>{actions.length > 0 && <details className="card-actions-menu" onClick={(event) => event.stopPropagation()}><summary aria-label={`${card.name} actions`}>•••</summary><div>{actions.map((action) => <button key={action.label} disabled={action.disabled} onClick={action.run}>{action.label}</button>)}</div></details>}</div><div className="card-tile-meta"><span className="draft-dot" /> {card.frames?.length ? `${card.frames.length} frames` : card.generatedImageKey ? "Generated" : "Draft"} <span>·</span> {sizeLabel}{onGenerate && <button className="generate-card-button" onClick={onGenerate} disabled={generating}>{generating ? "Generating…" : card.generatedImageKey ? "Regenerate" : "Generate"}</button>}</div>{card.kind === "animation" && onOpen && <button className="card-generate-animation" onClick={onGenerate} disabled={!onGenerate}>{card.versions?.length ? "Generate new version" : "Generate animation"}</button>}</article>;
}

function GeneratedAssetPreview({ imageKey, name }: { imageKey: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    void loadImage(imageKey).then((blob) => {
      if (blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    });
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageKey]);
  return url ? <img className="generated-asset-preview" src={url} alt={name} /> : <div className="card-art-grid"><span>◇</span></div>;
}

function AnchorPreview({ imageKey, dataUrl, name }: { imageKey?: string; dataUrl?: string; name: string }) {
  const [url, setUrl] = useState(dataUrl ?? "");
  useEffect(() => {
    if (dataUrl) { setUrl(dataUrl); return; }
    let objectUrl = "";
    if (imageKey) void loadImage(imageKey).then((blob) => { if (blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } });
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageKey, dataUrl]);
  return url ? <img src={url} alt={name} /> : <div className="anchor-placeholder"><span>✳</span><small>ANCHOR IMAGE</small></div>;
}

const viewDirections: Array<{ id: NonNullable<StudioProject["anchorDirection"]>; label: string; icon: string }> = [
  { id: "front", label: "Front", icon: "◉" },
  { id: "side-left", label: "Left side", icon: "◖" },
  { id: "side-right", label: "Right side", icon: "◗" },
  { id: "top-down", label: "Top-down", icon: "⊙" },
  { id: "isometric", label: "Isometric", icon: "◇" },
];

function ArtModePicker({ value, onChange }: { value: "pixel" | "hd"; onChange: (value: "pixel" | "hd") => void }) {
  return <fieldset className="direction-picker art-mode-picker"><legend>Art mode</legend><div className="art-mode-options">
    <button type="button" className={value === "pixel" ? "art-mode-option selected" : "art-mode-option"} aria-pressed={value === "pixel"} onClick={() => onChange("pixel")}>
      <span className="art-mode-icon pixel-mode-icon" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
      <strong>Pixel art</strong><small>Hard-edged pixels</small>
    </button>
    <button type="button" className={value === "hd" ? "art-mode-option selected" : "art-mode-option"} aria-pressed={value === "hd"} onClick={() => onChange("hd")}>
      <span className="art-mode-icon smooth-mode-icon" aria-hidden="true"><i /></span>
      <strong>Smooth / HD</strong><small>Soft detail</small>
    </button>
  </div></fieldset>;
}

function ViewDirectionPicker({ value, onChange }: { value: NonNullable<StudioProject["anchorDirection"]>; onChange: (value: NonNullable<StudioProject["anchorDirection"]>) => void }) {
  return <fieldset className="direction-picker"><legend>View direction</legend><div className="direction-options">{viewDirections.map((direction) => <button type="button" key={direction.id} className={value === direction.id ? "direction-option selected" : "direction-option"} aria-pressed={value === direction.id} aria-label={direction.label} title={direction.label} onClick={() => onChange(direction.id)}><span aria-hidden="true">{direction.icon}</span><small>{direction.label}</small></button>)}</div></fieldset>;
}

function GenerationJobPanel({ jobs, onCancel, onRetry, onClose }: { jobs: GenerationJob[]; onCancel: (id: string) => void; onRetry: (job: GenerationJob) => void; onClose: () => void }) {
  const visibleJobs = jobs.slice(0, 8);
  return <aside className="generation-job-panel" aria-label="Generation jobs"><div className="generation-job-heading"><strong>Generation jobs</strong><span>{jobs.filter((job) => job.status === "running" || job.status === "queued").length} active</span><button type="button" className="generation-job-close" aria-label="Close generation jobs" title="Close generation jobs" onClick={onClose}>×</button></div>{visibleJobs.map((job) => <div className="generation-job" key={job.id}><div className="generation-job-main"><span className={`job-state ${job.status}`} /><div><strong>{job.target === "anchor" ? "Project anchor" : job.target === "animation-frame" ? `Animation frame ${(job.frameIndex ?? 0) + 1}${job.cardId ? ` · ${job.cardId}` : ""}` : "Asset generation"}</strong><small>{job.status === "failed" || job.status === "cancelled" ? job.error ?? job.status : `${job.status} · ${job.progress}%`}</small></div></div>{job.status === "running" || job.status === "queued" ? <button onClick={() => onCancel(job.id)}>Cancel</button> : job.status === "failed" || job.status === "cancelled" ? <button onClick={() => onRetry(job)}>Retry</button> : <span className="job-done">Done</span>}</div>)}</aside>;
}

function CanvasSizeFields({ name, label, defaultValue, inheritedLabel }: { name: string; label: string; defaultValue: string; inheritedLabel?: string }) {
  return <>
    <label>{label}<select name={name} defaultValue={defaultValue} onChange={(event) => { const element = event.currentTarget.parentElement?.nextElementSibling; if (element instanceof HTMLElement) element.dataset.active = String(event.target.value === "custom"); }}>{inheritedLabel && <option value="inherit">{inheritedLabel}</option>}<option value="64">64 × 64{!inheritedLabel ? " — recommended" : ""}</option><option value="128">128 × 128</option><option value="512">512 × 512</option><option value="custom">Custom</option></select></label>
    <div className="custom-dimensions" data-active="false" id={`${name}-custom`}><label>Custom width<input name={name === "size" ? "customWidth" : "cardWidth"} type="number" min="1" max="4096" defaultValue="64" /></label><label>Custom height<input name={name === "size" ? "customHeight" : "cardHeight"} type="number" min="1" max="4096" defaultValue="64" /></label></div>
  </>;
}

function ThemeSettings({ theme, onChange }: { theme: "studio" | "academic"; onChange: (theme: "studio" | "academic") => void }) {
  return <section className="theme-settings-panel"><div className="theme-settings-copy"><div className="eyebrow">APPEARANCE</div><h2>Studio theme</h2><p>Choose between the original Studio palette and the academic blue palette: Yale Blue, Oxford Navy, Prussian Blue, Powder Blue, and Mint Cream.</p></div><div className="theme-options"><button type="button" className={`theme-option ${theme === "studio" ? "selected" : ""}`} aria-pressed={theme === "studio"} onClick={() => onChange("studio")}><span className="theme-swatch studio-swatch"><i/><i/><i/></span><strong>Studio</strong><small>Charcoal · Lime</small></button><button type="button" className={`theme-option ${theme === "academic" ? "selected" : ""}`} aria-pressed={theme === "academic"} onClick={() => onChange("academic")}><span className="theme-swatch academic-swatch"><i/><i/><i/><i/><i/></span><strong>Academic blue</strong><small>Yale · Oxford · Mint</small></button></div></section>;
}

function ProviderSettingsPanel({ profiles, activeProfile, activeProfileId, draftType, models, busy, message, onChoose, onSave, onTest, onDelete, onNew }: {
  profiles: ProviderProfile[];
  activeProfile: ProviderProfile | null;
  activeProfileId: string | null;
  draftType: NonNullable<ProviderProfile["providerType"]>;
  models: string[];
  busy: boolean;
  message: string;
  onChoose: (id: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onTest: () => void;
  onDelete: () => void;
  onNew: (type: NonNullable<ProviderProfile["providerType"]>) => void;
}) {
  const isConnected = /connected|responded|ready/i.test(message);
  const [browserKeyForSession, setBrowserKeyForSession] = useState("");
  const [apiKeyForSession, setApiKeyForSession] = useState("");
  const [browserKeyMessage, setBrowserKeyMessage] = useState("");
  const [rememberBrowserKey, setRememberBrowserKey] = useState(() => Boolean(activeProfile && isProviderSecretRemembered(activeProfile.id)));
  useEffect(() => {
    setRememberBrowserKey(Boolean(activeProfile && isProviderSecretRemembered(activeProfile.id)));
    setBrowserKeyForSession("");
    setBrowserKeyMessage("");
  }, [activeProfile?.id]);
  const statusLabel = busy ? "Checking" : isConnected ? "Connected" : activeProfile?.apiKeyConfigured ? "Ready to test" : "Needs setup";
  const providerType = activeProfile?.providerType ?? draftType;
  const profileNameDefault = activeProfile?.name ?? (draftType === "parley" ? "Parley" : draftType === "grok" ? "Grok Imagine" : "OpenAI-compatible");
  const baseUrlDefault = activeProfile?.baseUrl ?? (draftType === "parley" ? "https://parley.api.mit.edu" : draftType === "grok" ? "https://api.x.ai" : "https://api.openai.com");
  const modelDefault = activeProfile?.model ?? (draftType === "parley" ? "openai/gpt-image-2" : draftType === "grok" ? "grok-imagine-image-2.0" : "gpt-image-1");
  return <section className="provider-settings">
      <div className="provider-settings-heading"><div><div className="eyebrow">IMAGE GENERATION</div><h2>Provider</h2><p>Connect an OpenAI-compatible image API. Credentials are kept separate from project data.</p></div><div className="provider-add-actions"><button className="button secondary" type="button" onClick={() => onNew("openai-compatible")}>＋ OpenAI-compatible</button><button className="button secondary parley-add" type="button" onClick={() => onNew("parley")}>＋ Parley</button><button className="button secondary grok-add" type="button" onClick={() => onNew("grok")}>＋ Grok Image</button></div></div>
    <div className="provider-status-bar"><span className={`provider-status-dot ${busy ? "checking" : isConnected ? "connected" : ""}`} /><span><strong>{activeProfile?.name ?? "No provider selected"}</strong><small>{activeProfile ? `${activeProfile.baseUrl} · ${activeProfile.model}` : "Add a profile to enable image generation"}</small></span><span className={`provider-status-label ${isConnected ? "connected" : ""}`}>{statusLabel}</span></div>
    {profiles.length > 0 && <div className="provider-profile-tabs" role="tablist" aria-label="Provider profiles">{profiles.map((profile) => <button type="button" role="tab" aria-selected={profile.id === activeProfileId} key={profile.id} className={profile.id === activeProfileId ? "provider-profile-tab active" : "provider-profile-tab"} onClick={() => onChoose(profile.id)}><span className="profile-tab-name">{profile.name}</span><span className="profile-tab-model">{profile.model}</span></button>)}</div>}
    <form key={activeProfile?.id ?? `new-provider-${draftType}`} className="provider-form" onSubmit={onSave}>
      <input type="hidden" name="id" value={activeProfile?.id ?? ""} />
      <input type="hidden" name="providerType" value={providerType} />
      <div className="provider-form-heading"><h3>{activeProfile ? "Connection details" : `Add ${draftType === "parley" ? "Parley" : draftType === "grok" ? "Grok Image" : "OpenAI-compatible"}`}</h3><p>{providerType === "parley" ? "Parley uses the OpenAI image generation route with provider-specific model IDs and quality options." : providerType === "grok" ? "xAI Grok Imagine uses the OpenAI-compatible image generations route and returns image URLs." : "Use your provider’s OpenAI-compatible API base URL and image model name."}</p></div>
      <div className="provider-fields">
        <label className="provider-field">Profile name<span>Label used inside this app.</span><input name="name" defaultValue={profileNameDefault} placeholder="My image endpoint" required /></label>
        <label className="provider-field">Base URL<span>{providerType === "parley" ? "Parley API base URL." : providerType === "grok" ? "xAI API base URL." : "Include host or API prefix; `/v1` is optional."}</span><input name="baseUrl" type="url" defaultValue={baseUrlDefault} placeholder="https://api.openai.com" required /></label>
        <label className="provider-field">Image model ID<span>{providerType === "parley" ? "Use provider/model format, e.g. openai/gpt-image-2." : providerType === "grok" ? "Grok Imagine image model, e.g. grok-imagine-image-2.0." : "Must support the Images API generation route."}</span><input name="model" list="provider-model-options" defaultValue={modelDefault} placeholder="e.g. gpt-image-1" required /><datalist id="provider-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist></label>
        {providerType !== "grok" && <label className="provider-field">Image quality<span>{providerType === "parley" ? "Parley supports auto, low, medium, or high." : "Used when the endpoint accepts a quality option."}</span><select name="quality" defaultValue={activeProfile?.quality ?? "auto"}><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>}
         <label className="provider-field">API key<span>{activeProfile?.apiKeyConfigured ? "A key is configured for desktop or another session." : "Required to generate with this provider."}</span><input name="apiKey" type="password" autoComplete="new-password" placeholder={activeProfile?.apiKeyConfigured ? "Enter a replacement key" : "Paste API key"} required={!activeProfile?.apiKeyConfigured} /></label>
         {!window.__TAURI_INTERNALS__ && activeProfile?.apiKeyConfigured && <div className="provider-field browser-session-key"><label>Browser session key<span>{isProviderSecretRemembered(activeProfile.id) ? "Key is remembered in this browser on this device." : "Enter the key for this session. Remembering it is optional."}</span><input type="password" autoComplete="new-password" value={apiKeyForSession} onChange={(event) => setApiKeyForSession(event.target.value)} placeholder={isProviderSecretRemembered(activeProfile.id) ? "Key remembered — enter to replace" : "Enter key for browser session"} /></label><div className="browser-key-actions"><label className="remember-key-option"><input type="checkbox" checked={rememberBrowserKey} onChange={(event) => setRememberBrowserKey(event.target.checked)} /><span>Remember on this device</span></label><button type="button" className="button secondary" disabled={!apiKeyForSession.trim()} onClick={async () => { try { await saveBrowserProviderSecret(activeProfile.id, apiKeyForSession.trim(), rememberBrowserKey); setApiKeyForSession(""); setBrowserKeyForSession(activeProfile.id); setBrowserKeyMessage(rememberBrowserKey ? "API key remembered on this device and ready for this session." : "API key is ready for this session only."); } catch (error) { setBrowserKeyMessage(error instanceof Error ? error.message : "Could not save the browser API key."); } }}>Use key</button></div><small className="browser-key-storage-note">Remembered keys are stored in this browser’s local storage on this device.</small>{browserKeyForSession === activeProfile.id && <small className="session-key-ready">✓ Key ready for this session</small>}{browserKeyMessage && <small className="session-key-message" role="status">{browserKeyMessage}</small>}</div>}
        {(providerType === "openai-compatible" || providerType === "grok") && <div className="provider-feature-flags"><strong>Capabilities this endpoint supports</strong><label><input type="checkbox" name="imageToImage" defaultChecked={providerType === "grok" || activeProfile?.capabilities?.imageToImage === true} disabled={providerType === "grok"} /> Image edits/references{providerType === "grok" ? " (supported)" : ""}</label>{providerType === "grok" && <input type="hidden" name="imageToImage" value="on" />}<label><input type="checkbox" name="transparency" defaultChecked={activeProfile?.capabilities?.transparency ?? false} /> Transparent-background parameter</label><small>{providerType === "grok" ? "xAI Grok Imagine documents image edits; transparency is endpoint-dependent." : "Only enable options supported by this endpoint."}</small></div>}
      </div>
      <div className="provider-form-footer"><div className="provider-form-actions"><button type="submit" className="button primary">Save provider</button><button type="button" className="button secondary" disabled={!activeProfile?.apiKeyConfigured || busy} onClick={onTest}>{busy ? "Checking…" : providerType === "parley" ? "Verify API key" : "Test connection"}</button></div>{activeProfile && <button type="button" className="text-button destructive" onClick={onDelete}>Remove provider</button>}</div>
      {message && <p className={`provider-message ${isConnected ? "success" : ""}`} role="status">{isConnected && <span>✓</span>}{message}{models.length > 0 && <small>{models.length} model IDs available as suggestions above.</small>}</p>}
      <div className="provider-capabilities">{providerType === "parley" ? <><span><b>Generate</b><code>POST /v1/images/generations</code></span><span><b>Authentication</b>Bearer API key</span><span>Connection check validates the saved key locally; Parley’s supplied API docs do not list a models endpoint.</span></> : providerType === "grok" ? <><span><b>Generate</b><code>POST /v1/images/generations</code></span><span><b>Authentication</b>Bearer xAI API key</span><span>Grok Imagine image generation supports URL responses; xAI’s API docs show this route.</span></> : <><span><b>Test</b><code>GET /v1/models</code></span><span><b>Generate</b><code>POST /v1/images/generations</code></span></>}</div>
    </form>
  </section>;
}

function SkillForm({ skill, activeProject, onSubmit, onCancel }: {
  skill: SavedSkill | null;
  activeProject: StudioProject | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return <form onSubmit={onSubmit}>
    <label>Skill name<input name="name" defaultValue={skill?.name} placeholder="e.g. Cozy pixel-art props" required autoFocus /></label>
    <label>Description<input name="description" defaultValue={skill?.description} placeholder="When should this recipe be used?" /></label>
    <label>Category<select name="category" defaultValue={skill?.category ?? "general"}><option value="general">General</option><option value="character">Character</option><option value="animation">Animation</option><option value="asset">Asset</option></select></label>
    <label>Save to<select name="projectId" defaultValue={skill?.projectId ?? ""}><option value="">Global skills library</option>{activeProject && <option value={activeProject.id}>{activeProject.name} (project only)</option>}</select></label>
    <label>Prompt template<textarea name="prompt" defaultValue={skill?.promptTemplate} placeholder="Use placeholders like {subject}, {style}, or {motion}…" rows={4} required /></label>
    <label>Negative prompt<textarea name="negativePrompt" defaultValue={skill?.negativePrompt} placeholder="Things to avoid in generated results" rows={2} /></label>
    <div className="skill-default-grid"><label>Size preset<select name="size" defaultValue={skill?.defaults.size ?? ""}><option value="">Use project size</option><option value="64">64 × 64</option><option value="128">128 × 128</option><option value="512">512 × 512</option><option value="custom">Custom</option></select></label><label>Frame count<input name="frameCount" type="number" min="1" max="64" defaultValue={skill?.defaults.frameCount} placeholder="—" /></label><label>FPS<input name="fps" type="number" min="1" max="60" defaultValue={skill?.defaults.fps} placeholder="—" /></label></div>
    <div className="skill-checkboxes"><label><input type="checkbox" name="pixelArt" defaultChecked={skill?.defaults.pixelArt ?? false} /> Pixel art</label><label><input type="checkbox" name="transparentBackground" defaultChecked={skill?.defaults.transparentBackground ?? false} /> Transparent background</label><label><input type="checkbox" name="loop" defaultChecked={skill?.defaults.loop ?? false} /> Loop animation</label></div>
    <label>Workflow notes <small>(one per line)</small><textarea name="notes" defaultValue={skill?.workflowNotes?.join("\n")} placeholder="Inspect first frame before animating\nKeep silhouette stable" rows={2} /></label>
    <p className="form-note">Skills are structured prompt recipes. They do not run code.</p>
    <div className="dialog-actions"><button type="button" className="button secondary" onClick={onCancel}>Cancel</button><button type="submit" className="button primary">{skill ? "Save changes" : "Save skill"}</button></div>
  </form>;
}

function ProjectExportDialog({ project, onClose }: { project: StudioProject; onClose: () => void }) {
  const availableCards = project.cards.filter((card) => card.kind === "animation");
  const readyCards = availableCards.filter((card) => (card.frames?.length ?? 0) > 0);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => readyCards.map((card) => card.id));
  const [layout, setLayout] = useState<CombinedLayout>("vertical");
  const [padding, setPadding] = useState(16);
  const [includeCardExports, setIncludeCardExports] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const orderedCards = selectedIds.map((id) => readyCards.find((card) => card.id === id)).filter((card): card is StudioCard => Boolean(card));
  const frameDimensions = (card: StudioCard) => normalizedCanvas(card.size ?? project.size, card.canvasSize ?? (card.size === "custom" ? project.canvasSize : undefined));

  function toggleCard(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }

  function moveCard(index: number, delta: number) {
    setSelectedIds((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function exportProject() {
    setBusy(true);
    setMessage("");
    let animations: ExportAnimation[] = [];
    try {
      animations = await Promise.all(orderedCards.map(async (card) => {
        const dimensions = frameDimensions(card);
        const activeVersion = card.versions?.find((version) => version.id === card.activeVersionId);
        return {
        id: card.id,
        name: card.name,
        cardVersionId: activeVersion?.id ?? card.activeVersionId,
        anchorVersionId: activeVersion?.anchorVersionId ?? card.anchorVersionId ?? project.anchorVersionId,
        fps: card.fps ?? 8,
        loop: card.loop ?? true,
        width: dimensions.width,
        height: dimensions.height,
        frames: await Promise.all((card.frames ?? []).map(async (frame) => {
          const blob = await loadImage(frame.imageKey);
          if (!blob) throw new Error(`Missing frame image in “${card.name}”: ${frame.name}`);
          const image = new Image();
          image.src = URL.createObjectURL(blob);
          await image.decode();
          return { ...frame, image };
        })),
      }; }));
      const { canvas, animations: atlasAnimations } = renderCombinedSheet(animations, layout, padding);
      const imageBlob = await canvasPng(canvas);
      const filename = `${safeFilename(project.name)}-combined`;
      const atlas = {
        schema: "sprite-studio-atlas/v1",
        meta: { app: "Sprite Studio", format: "RGBA8888", size: { width: canvas.width, height: canvas.height }, scale: 1 },
        project: { id: project.id, name: project.name },
        sheet: { file: `${filename}.png`, layout, padding },
        animations: atlasAnimations.map((animation) => ({ ...animation, layout, padding })),
      };
      if (includeCardExports) {
        const files: Record<string, Uint8Array> = { [`${filename}.png`]: new Uint8Array(await imageBlob.arrayBuffer()), [`${filename}.json`]: new TextEncoder().encode(JSON.stringify(atlas, null, 2)) };
        for (const animation of animations) {
          const dimensions = { width: animation.width, height: animation.height };
          const columns = animation.frames.length;
          const { canvas: cardSheet, atlasFrames } = renderSheet(animation.frames, dimensions.width, dimensions.height, columns);
          const cardFilename = `${safeFilename(animation.name)}-${safeFilename(animation.id)}`;
          files[`cards/${cardFilename}.png`] = new Uint8Array(await (await canvasPng(cardSheet)).arrayBuffer());
          files[`cards/${cardFilename}.json`] = new TextEncoder().encode(JSON.stringify({ meta: { app: "Sprite Studio", format: "RGBA8888", size: { width: cardSheet.width, height: cardSheet.height }, scale: 1 }, animation: { name: animation.name, fps: animation.fps, loop: animation.loop, cardVersionId: animation.cardVersionId, anchorVersionId: animation.anchorVersionId }, frames: atlasFrames }, null, 2));
        }
        downloadBlob(new Blob([zipSync(files)], { type: "application/zip" }), `${filename}.zip`);
      } else {
        downloadBlob(imageBlob, `${filename}.png`);
        downloadBlob(new Blob([JSON.stringify(atlas, null, 2)], { type: "application/json" }), `${filename}.json`);
      }
      setMessage(includeCardExports ? "Combined and individual card exports downloaded in a ZIP." : "Combined sprite sheet and versioned atlas downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project export failed.");
    } finally {
      animations?.forEach((animation) => animation.frames.forEach((frame) => URL.revokeObjectURL(frame.image.src)));
      setBusy(false);
    }
  }

  return <Dialog title="Combined project export" onClose={onClose}>
    <div className="project-export-dialog">
      <p className="export-intro">Combine selected animation cards into one sheet. Each animation keeps its own frame order and metadata.</p>
      {availableCards.length === 0 ? <div className="export-empty">Create an animation card and import frames before exporting a combined sheet.</div> : <>
        <div className="export-card-list">
          {availableCards.map((card) => {
            const included = selectedIds.includes(card.id);
            const selectedIndex = selectedIds.indexOf(card.id);
            return <label key={card.id} className={`export-card-row ${included ? "included" : ""} ${!card.frames?.length ? "unavailable" : ""}`}>
              <input type="checkbox" checked={included} disabled={!card.frames?.length} onChange={(event) => toggleCard(card.id, event.target.checked)} />
              <span className="export-card-name"><strong>{card.name}</strong><small>{card.frames?.length ? `${card.frames.length} frames · ${card.fps ?? 8} FPS · ${frameDimensions(card).width}×${frameDimensions(card).height}` : "No imported frames yet"}</small></span>
              {included && <span className="order-controls"><button type="button" aria-label={`Move ${card.name} up`} disabled={selectedIndex === 0} onClick={(event) => { event.preventDefault(); moveCard(selectedIndex, -1); }}>↑</button><button type="button" aria-label={`Move ${card.name} down`} disabled={selectedIndex === selectedIds.length - 1} onClick={(event) => { event.preventDefault(); moveCard(selectedIndex, 1); }}>↓</button></span>}
            </label>;
          })}
        </div>
        <div className="export-options"><label>Sheet layout<select value={layout} onChange={(event) => setLayout(event.target.value as CombinedLayout)}><option value="vertical">Vertical — cards stacked</option><option value="horizontal">Horizontal — cards side by side</option><option value="grid">Grid — compact arrangement</option></select></label><label>Spacing<input type="number" min="0" max="256" value={padding} onChange={(event) => setPadding(Math.max(0, Number(event.target.value) || 0))} /><small>pixels between cards</small></label></div><label className="include-card-exports"><input type="checkbox" checked={includeCardExports} onChange={(event) => setIncludeCardExports(event.target.checked)} /> Include individual card sheets and atlases in ZIP</label>
        <p className="export-summary">{orderedCards.length} animation{orderedCards.length === 1 ? "" : "s"} selected · each uses its own frame canvas</p>
      </>}
      {message && <p className="export-message" role="status">{message}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button><button type="button" className="button primary" disabled={busy || orderedCards.length === 0} onClick={() => void exportProject()}>{busy ? "Exporting…" : "Export PNG + atlas"}</button></div>
    </div>
  </Dialog>;
}

function renderStillAsset(canvas: HTMLCanvasElement, image: HTMLImageElement, canvasSize: CanvasSize, crop: StudioCard["assetCrop"], placement: NonNullable<StudioCard["assetPlacement"]>) {
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  const sx = Math.max(0, crop?.x ?? 0);
  const sy = Math.max(0, crop?.y ?? 0);
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, crop?.width ?? image.naturalWidth));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, crop?.height ?? image.naturalHeight));
  const fit = Math.min(canvas.width / sw, canvas.height / sh) * placement.scale;
  const width = sw * fit;
  const height = sh * fit;
  context.drawImage(image, sx, sy, sw, sh, (canvas.width - width) / 2 + placement.offsetX, (canvas.height - height) / 2 + placement.offsetY, width, height);
}

function StillAssetEditor({ card, canvasSize, onClose, onUpdate, onGenerate, generating }: {
  card: StudioCard;
  canvasSize: CanvasSize;
  onClose: () => void;
  onUpdate: (update: Partial<StudioCard>) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: canvasSize.width, height: canvasSize.height });
  const [placement, setPlacement] = useState(card.assetPlacement ?? { scale: 1, offsetX: 0, offsetY: 0 });
  const [crop, setCrop] = useState(card.assetCrop);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const versionList = card.assetVersions ?? [];

  useEffect(() => {
    let url = "";
    let cancelled = false;
    const imageKey = card.generatedImageKey;
    if (!imageKey) { setImageUrl(""); setImageSize(canvasSize); return; }
    void loadImage(imageKey).then((blob) => {
      if (blob && !cancelled) { url = URL.createObjectURL(blob); setImageUrl(url); }
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [card.generatedImageKey]);

  useEffect(() => {
    if (!imageUrl) return;
    const image = new Image();
    image.src = imageUrl;
    void image.decode().then(() => {
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      if (canvasRef.current) renderStillAsset(canvasRef.current, image, canvasSize, crop, placement);
    }).catch(() => setMessage("Could not load the generated asset image."));
  }, [imageUrl, canvasSize.width, canvasSize.height, crop, placement]);

  useEffect(() => {
    const timer = window.setTimeout(() => onUpdate({ assetPlacement: placement, assetCrop: crop }), 150);
    return () => window.clearTimeout(timer);
  }, [placement, crop]);

  function changeCrop(field: "x" | "y" | "width" | "height", value: number) {
    const current = crop ?? { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
    const next = { ...current, [field]: value };
    next.x = Math.max(0, Math.min(imageSize.width - 1, next.x));
    next.y = Math.max(0, Math.min(imageSize.height - 1, next.y));
    next.width = Math.max(1, Math.min(imageSize.width - next.x, next.width));
    next.height = Math.max(1, Math.min(imageSize.height - next.y, next.height));
    setCrop(next);
  }

  function selectVersion(version: AssetVersion) {
    setPlacement({ scale: 1, offsetX: 0, offsetY: 0 });
    setCrop(undefined);
    onUpdate({ generatedImageKey: version.imageKey, activeAssetVersionId: version.id, assetPlacement: { scale: 1, offsetX: 0, offsetY: 0 }, assetCrop: undefined });
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!imageUrl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setPlacement((current) => ({ ...current, offsetX: current.offsetX + event.movementX * canvasSize.width / rect.width, offsetY: current.offsetY + event.movementY * canvasSize.height / rect.height }));
  }

  async function exportPng() {
    if (!imageUrl || !canvasRef.current) return setMessage("Generate an asset before exporting a PNG.");
    downloadBlob(await canvasPng(canvasRef.current), `${safeFilename(card.name)}.png`);
    setMessage("Cropped and placed asset exported as PNG.");
  }

  return <section className="editor-page still-asset-editor">
    <div className="editor-topline"><button className="text-button" onClick={onClose}>← Back to project</button><span className="tag">STILL ASSET</span></div>
    <div className="editor-heading"><div><div className="eyebrow">ASSET EDITOR</div><h1>{card.name}</h1><p>{card.prompt || "Add a prompt to describe this game asset."}</p></div><div className="editor-actions"><button className="button secondary" onClick={onGenerate} disabled={generating}>{generating ? "Generating…" : versionList.length ? "Generate variations" : "Generate asset"}</button><button className="button primary" onClick={() => void exportPng()} disabled={!imageUrl}>Export PNG</button></div></div>
    {versionList.length > 0 && <div className="animation-version-strip asset-version-strip"><span>Versions</span>{versionList.map((version) => <button key={version.id} className={version.id === card.activeAssetVersionId ? "animation-version active" : "animation-version"} aria-pressed={version.id === card.activeAssetVersionId} onClick={() => selectVersion(version)}><strong>v{version.number}{version.id === card.activeAssetVersionId ? " · current" : ""}</strong><small>{new Date(version.createdAt).toLocaleDateString()}</small></button>)}</div>}
    <div className="asset-editor-layout"><section className="preview-panel"><div className="panel-header"><div><span className="eyebrow">CANVAS PREVIEW</span><span className="preview-resolution">{canvasSize.width} × {canvasSize.height}</span></div><span className="preview-resolution">Drag to place</span></div><div className="editor-canvas-wrap"><div className="editor-canvas checkerboard"><canvas ref={canvasRef} className="draggable-canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} aria-label="Still asset preview; drag to place" />{!imageUrl && <div className="canvas-empty"><span>◇</span><strong>Generate this asset</strong><small>Original images are kept in asset versions</small></div>}</div></div><div className="align-tools"><div className="align-label"><strong>Placement</strong><span>Scale and offset are stored separately</span></div><label>Scale <input aria-label="Asset scale" type="number" min="0.1" max="8" step="0.1" value={placement.scale} onChange={(event) => setPlacement((current) => ({ ...current, scale: Math.max(0.1, Math.min(8, Number(event.target.value) || 0.1)) }))} /></label><button className="text-button" onClick={() => setPlacement({ scale: 1, offsetX: 0, offsetY: 0 })}>Reset placement</button></div></section>
      <aside className="frame-settings asset-edit-settings"><div className="panel-header"><span className="eyebrow">CROP & PLACEMENT</span></div><p className="asset-source-info">Source: {imageSize.width} × {imageSize.height} · original remains unchanged</p><div className="asset-crop-fields">{(["x", "y", "width", "height"] as const).map((field) => <label key={field}>{field.toUpperCase()}<input type="number" min={field === "width" || field === "height" ? 1 : 0} max={field === "x" ? imageSize.width - 1 : field === "y" ? imageSize.height - 1 : field === "width" ? imageSize.width : imageSize.height} value={(crop ?? { x: 0, y: 0, width: imageSize.width, height: imageSize.height })[field]} onChange={(event) => changeCrop(field, Number(event.target.value) || 0)} disabled={!imageUrl} /></label>)}</div><button className="text-button" disabled={!crop || !imageUrl} onClick={() => setCrop(undefined)}>Reset crop to source</button><div className="setting-divider"/><div className="selected-frame-info"><span>Offset X</span><strong>{Math.round(placement.offsetX)} px</strong></div><div className="selected-frame-info"><span>Offset Y</span><strong>{Math.round(placement.offsetY)} px</strong></div><div className="selected-frame-info"><span>Art mode</span><strong>{card.artMode === "hd" ? "Smooth / HD" : "Pixel art"}</strong></div><div className="selected-frame-info"><span>Background</span><strong>{card.transparentBackground === false ? "Solid" : "Transparent"}</strong></div></aside></div>{message && <p className="editor-message" role="status">{message}</p>}
  </section>;
}

function FrameEditor({ card, canvasSize, onClose, onSave, onSaveAsSkill, onSaveCardSettings, onSavePromptAndPhases, onSavePreparedPose, onRename, onGenerateAnimation, onSelectVersion, onDelete }: {
  card: StudioCard; onClose: () => void;
  canvasSize: CanvasSize;
  onSave: (frames: StudioFrame[], fps: number, loop: boolean) => void;
  onSaveAsSkill: (settings: { fps: number; loop: boolean; frameCount: number }) => void;
  onSaveCardSettings: (settings: Partial<StudioCard>) => void;
  onSavePromptAndPhases: (prompt: string, phases: AnimationPhase[]) => void;
  onSavePreparedPose: (file?: File) => void;
  onRename: (name: string) => void;
  onGenerateAnimation: () => void;
  onSelectVersion: (version: AnimationVersion) => void;
  onDelete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [frames, setFrames] = useState<StudioFrame[]>(card.frames ?? []);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const loadedFrameKeys = useRef(new Set<string>());
  const frameObjectUrls = useRef<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fps, setFps] = useState(card.fps ?? 8);
  const [loop, setLoop] = useState(card.loop ?? true);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editingPivot, setEditingPivot] = useState(false);
  const [onionSkin, setOnionSkin] = useState(true);
  const [alignmentMode, setAlignmentMode] = useState<"manual" | "center" | "grounded" | "custom-pivot">("manual");
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0]);
  const [sheetLayout, setSheetLayout] = useState<FrameLayout>("grid");
  const [sheetPadding, setSheetPadding] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<"checkerboard" | "solid" | "transparent">("checkerboard");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [inspectDifference, setInspectDifference] = useState(false);
  const [differencePercent, setDifferencePercent] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [cardName, setCardName] = useState(card.name);
  const poseInputRef = useRef<HTMLInputElement>(null);
  const [startPoseUrl, setStartPoseUrl] = useState("");
  const [editPrompt, setEditPrompt] = useState(card.prompt);
  const [editPhases, setEditPhases] = useState<AnimationPhase[]>(card.phases ?? []);
  const frameWidth = canvasSize.width;
  const frameHeight = canvasSize.height;
  const activeFrame = frames[activeIndex];
  const activeImageUrl = activeFrame ? imageUrls[activeFrame.imageKey] : undefined;
  const frameImageKeys = [...new Set([...(card.frames ?? []).map((frame) => frame.imageKey), ...frames.map((frame) => frame.imageKey)])].join("\u0000");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(frameImageKeys.split("\u0000").filter(Boolean).map(async (imageKey) => {
      if (loadedFrameKeys.current.has(imageKey)) return;
      loadedFrameKeys.current.add(imageKey);
      try {
        const blob = await loadImage(imageKey);
        if (!blob) { loadedFrameKeys.current.delete(imageKey); return; }
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(objectUrl); loadedFrameKeys.current.delete(imageKey); return; }
        frameObjectUrls.current.push(objectUrl);
        setImageUrls((current) => ({ ...current, [imageKey]: objectUrl }));
      } catch {
        loadedFrameKeys.current.delete(imageKey);
        // Keep missing generated/imported images addressable for recovery in the frame strip.
      }
    }));
    return () => { cancelled = true; };
  }, [card.id, frameImageKeys]);

  useEffect(() => () => frameObjectUrls.current.forEach(URL.revokeObjectURL), []);

  useEffect(() => {
    const incomingFrames = card.frames ?? [];
    const normalizedIncoming = incomingFrames.map((frame) => normalizeFrameTiming(frame, card.fps) as StudioFrame);
    if (JSON.stringify(normalizedIncoming) === JSON.stringify(frames)) return;
    setFrames(structuredClone(normalizedIncoming));
    setActiveIndex((index) => incomingFrames.length ? Math.min(index, incomingFrames.length - 1) : 0);
  }, [card.frames]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    if (card.startPoseImageKey) void loadImage(card.startPoseImageKey).then((blob) => {
      if (blob && !cancelled) { objectUrl = URL.createObjectURL(blob); setStartPoseUrl(objectUrl); }
    });
    else setStartPoseUrl("");
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [card.startPoseImageKey]);

  useEffect(() => { setEditPrompt(card.prompt); setEditPhases(card.phases ?? []); }, [card.prompt, card.phases]);

  const saveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => onSave(frames, fps, loop), 120);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [frames, fps, loop]);
  const settingsSaveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = window.setTimeout(() => onSaveCardSettings({ frameCount: Math.max(1, frames.length), fps: Math.max(1, fps), loop }), 120);
    return () => window.clearTimeout(settingsSaveTimerRef.current);
  }, [frames.length, fps, loop]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    setAnimating(true);
    const timer = window.setInterval(() => {
      if (!loop && activeIndex >= frames.length - 1) {
        setPlaying(false);
        setAnimating(false);
        return;
      }
      setActiveIndex((index) => loop ? (index + 1) % frames.length : Math.min(index + 1, frames.length - 1));
    }, 1000 / Math.max(1, fps));
    return () => window.clearInterval(timer);
  }, [playing, frames.length, activeIndex, fps, loop]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.imageSmoothingEnabled = false;
      if (!activeImageUrl || !activeFrame) { context.clearRect(0, 0, frameWidth, frameHeight); return; }
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.imageSmoothingEnabled = false;
    let cancelled = false;
    const drawFrame = async (frame: StudioFrame, url: string, opacity = 1) => {
      const image = new Image();
      image.src = url;
      try { await image.decode(); } catch { return undefined; }
      return { frame, image, opacity };
    };
    void (async () => {
      const adjacent = onionSkin ? [frames[activeIndex - 1], frames[activeIndex + 1]].filter((frame): frame is StudioFrame => Boolean(frame && imageUrls[frame.imageKey])) : [];
      const layers = await Promise.all([
        ...adjacent.map((frame) => drawFrame(frame, imageUrls[frame.imageKey], 0.22)),
        drawFrame(activeFrame, activeImageUrl),
      ]);
      if (cancelled) return;
      for (const layer of layers) {
        if (!layer) continue;
        const { frame, image, opacity } = layer;
        const placement = frameImagePlacement(frame, frameWidth, frameHeight, image.naturalWidth, image.naturalHeight);
        context.globalAlpha = opacity;
        context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
      }
      if (inspectDifference && !animating && frames.length > 1) {
        const following = frames[(activeIndex + 1) % frames.length];
        const followingLayer = following && imageUrls[following.imageKey] ? await drawFrame(following, imageUrls[following.imageKey]) : undefined;
        if (followingLayer && !cancelled) {
          const difference = document.createElement("canvas");
          difference.width = frameWidth;
          difference.height = frameHeight;
          const differenceContext = difference.getContext("2d");
          if (differenceContext) {
            const placement = frameImagePlacement(followingLayer.frame, frameWidth, frameHeight, followingLayer.image.naturalWidth, followingLayer.image.naturalHeight);
            differenceContext.imageSmoothingEnabled = false;
            differenceContext.drawImage(followingLayer.image, placement.x, placement.y, placement.width, placement.height);
            const nextPixels = differenceContext.getImageData(0, 0, frameWidth, frameHeight).data;
            const activeDifference = document.createElement("canvas");
            activeDifference.width = frameWidth;
            activeDifference.height = frameHeight;
            const activeContext = activeDifference.getContext("2d");
            if (!activeContext) return;
            const activePlacement = frameImagePlacement(activeFrame, frameWidth, frameHeight, layers[layers.length - 1]!.image.naturalWidth, layers[layers.length - 1]!.image.naturalHeight);
            activeContext.imageSmoothingEnabled = false;
            activeContext.drawImage(layers[layers.length - 1]!.image, activePlacement.x, activePlacement.y, activePlacement.width, activePlacement.height);
            const currentPixels = activeContext.getImageData(0, 0, frameWidth, frameHeight).data;
            let changed = 0;
            for (let pixel = 0; pixel < nextPixels.length; pixel += 4) if (nextPixels[pixel] !== currentPixels[pixel] || nextPixels[pixel + 1] !== currentPixels[pixel + 1] || nextPixels[pixel + 2] !== currentPixels[pixel + 2] || nextPixels[pixel + 3] !== currentPixels[pixel + 3]) changed += 1;
            setDifferencePercent(Math.round(changed / (frameWidth * frameHeight) * 100));
            context.save();
            context.globalAlpha = 0.28;
            context.globalCompositeOperation = "difference";
            context.drawImage(difference, 0, 0);
            context.restore();
          }
        }
      } else setDifferencePercent(null);
      context.globalAlpha = 1;
      context.strokeStyle = "rgba(201,243,106,.45)";
      context.lineWidth = Math.max(1, frameWidth / 128);
      context.beginPath();
      context.moveTo(frameWidth / 2, 0);
      context.lineTo(frameWidth / 2, frameHeight);
      context.moveTo(0, frameHeight * 0.9);
      context.lineTo(frameWidth, frameHeight * 0.9);
      context.stroke();
      context.fillStyle = editingPivot ? "#ffb454" : "#c9f36a";
      context.beginPath();
      context.arc(activeFrame.pivotX, activeFrame.pivotY, Math.max(1, frameWidth / 32), 0, Math.PI * 2);
      context.fill();
    })();
    return () => { cancelled = true; };
  }, [activeImageUrl, activeFrame, frames, imageUrls, activeIndex, frameWidth, frameHeight, editingPivot, onionSkin, inspectDifference, animating]);

  function changeActiveFrame(update: (frame: StudioFrame) => StudioFrame) {
    setFrames((current) => current.map((frame, index) => index === activeIndex ? update(frame) : frame));
  }

  async function importFrames(files: FileList | File[] | null) {
    if (!files) return;
    const nextFrames: StudioFrame[] = [];
    const nextUrls: Record<string, string> = {};
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const imageKey = `frame-${makeId()}`;
      try {
        await saveImage(imageKey, file);
      const frame: StudioFrame = { id: makeId(), imageKey, name: file.name, offsetX: 0, offsetY: 0, pivotX: frameWidth / 2, pivotY: frameHeight * 0.9, durationMs: Math.round(1000 / Math.max(1, fps)) };
        nextFrames.push(frame);
        nextUrls[imageKey] = URL.createObjectURL(file);
      } catch {
        setMessage("Could not store imported frames in this browser. Check local storage availability.");
      }
    }
    if (nextFrames.length) {
      setFrames((current) => [...current, ...nextFrames]);
      setImageUrls((current) => ({ ...current, ...nextUrls }));
      setActiveIndex(frames.length);
      setSelectedIndices([frames.length]);
      setMessage(`${nextFrames.length} frame${nextFrames.length === 1 ? "" : "s"} imported.`);
    }
  }

  async function importImageBlobs(blobs: Blob[]) {
    const files = blobs.map((blob, index) => new File([blob], `pasted-frame-${Date.now()}-${index + 1}.png`, { type: blob.type || "image/png" }));
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    await importFrames(transfer.files);
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.read) {
      setMessage("Clipboard image access is not available here. Copy an image, then use Ctrl/Cmd+V while this editor is open.");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const blobs: Blob[] = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) blobs.push(await item.getType(imageType));
      }
      if (blobs.length) await importImageBlobs(blobs);
      else setMessage("No image found on the clipboard.");
    } catch {
      setMessage("Clipboard access was denied. Copy an image and press Ctrl/Cmd+V in the editor.");
    }
  }

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))) return;
      const images = Array.from(event.clipboardData?.items ?? []).filter((item) => item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
      if (!images.length) return;
      event.preventDefault();
      void importFrames(images);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [frameWidth]);

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (!activeFrame) return;
    if (editingPivot) {
      const rect = event.currentTarget.getBoundingClientRect();
      changeActiveFrame((frame) => ({ ...frame, pivotX: Math.round((event.clientX - rect.left) * frameWidth / rect.width), pivotY: Math.round((event.clientY - rect.top) * frameHeight / rect.height) }));
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function dragSprite(event: PointerEvent<HTMLCanvasElement>) {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (editingPivot) {
      changeActiveFrame((frame) => ({ ...frame, pivotX: Math.max(0, Math.min(frameWidth, Math.round((event.clientX - rect.left) * frameWidth / rect.width))), pivotY: Math.max(0, Math.min(frameHeight, Math.round((event.clientY - rect.top) * frameHeight / rect.height))) }));
      return;
    }
    const scale = frameWidth / rect.width;
    changeActiveFrame((frame) => ({ ...frame, offsetX: Math.round(frame.offsetX + event.movementX * scale), offsetY: Math.round(frame.offsetY + event.movementY * scale) }));
  }

  function nudge(dx: number, dy: number) { changeActiveFrame((frame) => ({ ...frame, offsetX: frame.offsetX + dx, offsetY: frame.offsetY + dy })); }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.target instanceof HTMLElement) || event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      const amount = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") { event.preventDefault(); nudge(-amount, 0); }
      else if (event.key === "ArrowRight") { event.preventDefault(); nudge(amount, 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); nudge(0, -amount); }
      else if (event.key === "ArrowDown") { event.preventDefault(); nudge(0, amount); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex]);

  async function alignFrame() {
    if (!activeFrame || !activeImageUrl) return;
    if (alignmentMode === "custom-pivot") {
      changeActiveFrame((frame) => ({ ...frame, offsetX: Math.round(frame.offsetX + frameWidth / 2 - frame.pivotX - frame.offsetX), offsetY: Math.round(frame.offsetY + frameHeight / 2 - frame.pivotY - frame.offsetY) }));
      return;
    }
    const image = new Image();
    image.src = activeImageUrl;
    try { await image.decode(); } catch { return; }
    const boundsCanvas = document.createElement("canvas");
    boundsCanvas.width = image.naturalWidth;
    boundsCanvas.height = image.naturalHeight;
    const boundsContext = boundsCanvas.getContext("2d", { willReadFrequently: true });
    if (!boundsContext) return;
    boundsContext.drawImage(image, 0, 0);
    const pixels = boundsContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data;
    let minX = image.naturalWidth, minY = image.naturalHeight, maxX = -1, maxY = -1;
    for (let y = 0; y < image.naturalHeight; y++) for (let x = 0; x < image.naturalWidth; x++) {
      if (pixels[(y * image.naturalWidth + x) * 4 + 3] > 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    }
    if (maxX < 0) { minX = 0; minY = 0; maxX = image.naturalWidth - 1; maxY = image.naturalHeight - 1; }
    const scale = Math.min(frameWidth / image.naturalWidth, frameHeight / image.naturalHeight);
    const imageLeft = (frameWidth - image.naturalWidth * scale) / 2;
    const imageTop = (frameHeight - image.naturalHeight * scale) / 2;
    const left = imageLeft + minX * scale + activeFrame.offsetX;
    const top = imageTop + minY * scale + activeFrame.offsetY;
    const width = (maxX - minX + 1) * scale;
    const height = (maxY - minY + 1) * scale;
    const targetX = frameWidth / 2;
    const targetY = alignmentMode === "grounded" ? frameHeight * 0.9 : frameHeight / 2;
    const spriteX = left + width / 2;
    const spriteY = alignmentMode === "grounded" ? top + height : top + height / 2;
    changeActiveFrame((frame) => ({ ...frame, offsetX: Math.round(frame.offsetX + targetX - spriteX), offsetY: Math.round(frame.offsetY + targetY - spriteY) }));
  }

  function matchPrevious() {
    const previous = frames[activeIndex - 1];
    if (previous) changeActiveFrame((frame) => ({ ...frame, offsetX: previous.offsetX, offsetY: previous.offsetY }));
  }

  function applyPlacementToSelected() {
    if (!activeFrame) return;
    const targets = new Set(selectedIndices.filter((index) => index !== activeIndex));
    setFrames((current) => current.map((frame, index) => targets.has(index) ? { ...frame, offsetX: activeFrame.offsetX, offsetY: activeFrame.offsetY } : frame));
  }

  async function loadExportFrames() {
    return Promise.all(frames.map(async (frame) => {
      const blob = await loadImage(frame.imageKey);
      if (!blob) throw new Error(`Missing frame image: ${frame.name}`);
      const image = new Image();
      const url = URL.createObjectURL(blob);
      image.src = url;
      try { await image.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
      return { ...frame, image, sourceUrl: url };
    }));
  }

  async function exportCardSheet() {
    setExportBusy(true);
    let exportFrames: Awaited<ReturnType<typeof loadExportFrames>> = [];
    try {
      exportFrames = await loadExportFrames();
      const columns = sheetLayout === "horizontal" ? exportFrames.length : Math.ceil(Math.sqrt(exportFrames.length));
      const { canvas, atlasFrames } = renderSheet(exportFrames, frameWidth, frameHeight, columns, sheetPadding);
      const sheetBlob = await canvasPng(canvas);
      const base = safeFilename(card.name);
      downloadBlob(sheetBlob, `${base}-spritesheet.png`);
      const activeVersion = card.versions?.find((version) => version.id === card.activeVersionId);
      const atlas = { schema: "sprite-studio-atlas/v1", meta: { app: "Sprite Studio", format: "RGBA8888", size: { width: canvas.width, height: canvas.height }, scale: 1 }, animations: [{ id: card.id, name: card.name, cardVersionId: activeVersion?.id, anchorVersionId: activeVersion?.anchorVersionId ?? card.anchorVersionId, fps, loop, frameWidth, frameHeight, layout: sheetLayout, padding: sheetPadding, frames: atlasFrames }] };
      downloadBlob(new Blob([JSON.stringify(atlas, null, 2)], { type: "application/json" }), `${base}-atlas.json`);
      setMessage(`Sprite sheet (${sheetLayout}, ${sheetPadding}px padding) and atlas exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      exportFrames.forEach((frame) => URL.revokeObjectURL(frame.sourceUrl));
      setExportBusy(false);
    }
  }

  async function exportFrameZip() {
    setExportBusy(true);
    let exportFrames: Awaited<ReturnType<typeof loadExportFrames>> = [];
    try {
      exportFrames = await loadExportFrames();
      const files = await Promise.all(exportFrames.map(async (frame, index) => ({ name: `${String(index + 1).padStart(3, "0")}-${safeFilename(frame.name)}.png`, data: new Uint8Array(await (await canvasPng(renderSheet([frame], frameWidth, frameHeight, 1).canvas)).arrayBuffer()) })));
      const archive = framesToZip(files);
      downloadBlob(new Blob([archive], { type: "application/zip" }), `${safeFilename(card.name)}-frames.zip`);
      setMessage(`${files.length} normalized PNG frames exported as ZIP.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Frame ZIP export failed.");
    } finally { exportFrames.forEach((frame) => URL.revokeObjectURL(frame.sourceUrl)); setExportBusy(false); }
  }

  async function exportAnimation(format: "gif" | "webp" | "apng") {
    setExportBusy(true);
    let exportFrames: Awaited<ReturnType<typeof loadExportFrames>> = [];
    try {
      exportFrames = await loadExportFrames();
      const normalizedFrames = renderAnimationFrames(exportFrames, frameWidth, frameHeight);
      const base = safeFilename(card.name);
      if (format === "gif") downloadBlob(new Blob([encodeGif(normalizedFrames, loop)], { type: "image/gif" }), `${base}.gif`);
      else if (format === "apng") downloadBlob(new Blob([encodeApng(normalizedFrames, loop)], { type: "image/apng" }), `${base}.apng.png`);
      else downloadBlob(new Blob([await encodeAnimatedWebp(normalizedFrames, loop)], { type: "image/webp" }), `${base}.webp`);
      setMessage(`${format.toUpperCase()} animation exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${format.toUpperCase()} export failed.`);
    } finally { exportFrames.forEach((frame) => URL.revokeObjectURL(frame.sourceUrl)); setExportBusy(false); }
  }

  async function exportCurrentFrame() {
    if (!activeFrame) return;
    const framesForSheet = frames.slice(activeIndex, activeIndex + 1);
    const blob = await loadImage(activeFrame.imageKey);
    if (!blob) return setMessage("This frame image is missing from local storage.");
    const image = new Image();
    image.src = URL.createObjectURL(blob);
    await image.decode();
    const { canvas } = renderSheet([{ ...framesForSheet[0], image }], frameWidth, frameHeight, 1);
    URL.revokeObjectURL(image.src);
    downloadBlob(await canvasPng(canvas), `${safeFilename(card.name)}-frame-${String(activeIndex + 1).padStart(2, "0")}.png`);
  }

  return <section className="editor-page">
    <div className="editor-topline"><button className="text-button" onClick={onClose}>← Back to project</button><span className="tag">ANIMATION CARD</span><button className="button destructive-button" onClick={onDelete}>Delete animation</button></div>
    <div className="editor-heading"><div><div className="eyebrow">FRAME EDITOR</div><div className="editor-title-row"><h1>{card.name}</h1><button className="icon-button rename-card-button" aria-label="Rename animation card" title="Rename card" onClick={() => { setCardName(card.name); setRenameOpen(true); }}>✎</button></div><p>{card.prompt || "Add a motion prompt and phases to generate this animation."}</p></div><div className="editor-actions"><button className="button secondary" onClick={() => fileInputRef.current?.click()}>↑ Import frames</button><button className="button secondary" onClick={() => void pasteFromClipboard()}>▣ Paste frame</button><input ref={fileInputRef} className="hidden-file" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { void importFrames(event.target.files); event.currentTarget.value = ""; }} /><button className="button secondary" onClick={() => onSaveAsSkill({ fps, loop, frameCount: frames.length })}>Save as skill</button><button className="button secondary" disabled={!card.phases?.length} onClick={onGenerateAnimation}>Generate animation</button><button className="button primary" disabled={!frames.length || exportBusy} onClick={() => void exportCardSheet()}>Export card sheet</button></div></div>
    {(card.versions?.length ?? 0) > 0 && <div className="animation-version-strip"><span>Versions</span>{card.versions?.map((version) => <button key={version.id} className={version.id === card.activeVersionId ? "animation-version active" : "animation-version"} aria-pressed={version.id === card.activeVersionId} onClick={() => onSelectVersion(version)}><strong>v{version.number}{version.id === card.activeVersionId ? " · current" : ""}</strong><small>{version.frames.length} frames · {version.fps} FPS</small></button>)}</div>}
    {renameOpen && <Dialog title="Rename animation card" onClose={() => setRenameOpen(false)}><form onSubmit={(event) => { event.preventDefault(); const name = cardName.trim(); if (name) onRename(name); setRenameOpen(false); }}><label>Card name<input autoFocus value={cardName} onChange={(event) => setCardName(event.target.value)} required /></label><div className="dialog-actions"><button className="button secondary" type="button" onClick={() => setRenameOpen(false)}>Cancel</button><button className="button primary" type="submit">Save name</button></div></form></Dialog>}
    <div className="phase-editor editor-panel"><div className="phase-editor-heading"><div><span className="eyebrow">MOTION SEQUENCE</span><small>Each phase becomes one generated frame. Adjust its pose prompt before generating.</small></div><button className="text-button" onClick={() => setEditPhases((phases) => [...phases, { id: makeId(), label: `Phase ${phases.length + 1}`, prompt: "Describe the key pose and action" }])}>＋ Add phase</button></div><label className="animation-prompt-edit">Animation prompt<textarea value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} onBlur={() => onSavePromptAndPhases(editPrompt, editPhases)} rows={3} /></label>{editPhases.length ? <div className="phase-editor-list">{editPhases.map((phase, index) => <div className="phase-editor-row" key={phase.id}><span className="phase-number">{String(index + 1).padStart(2, "0")}</span><label className="phase-label-field">Phase name<input aria-label={`Phase ${index + 1} name`} value={phase.label} onChange={(event) => setEditPhases((phases) => phases.map((item) => item.id === phase.id ? { ...item, label: event.target.value } : item))} onBlur={() => onSavePromptAndPhases(editPrompt, editPhases)} /></label><label className="phase-prompt-field">Pose prompt<textarea aria-label={`Phase ${index + 1} prompt`} rows={2} value={phase.prompt} onChange={(event) => setEditPhases((phases) => phases.map((item) => item.id === phase.id ? { ...item, prompt: event.target.value } : item))} onBlur={() => onSavePromptAndPhases(editPrompt, editPhases)} /></label><button className="remove-phase-button" aria-label={`Remove phase ${index + 1}`} onClick={() => { const phases = editPhases.filter((item) => item.id !== phase.id); setEditPhases(phases); onSavePromptAndPhases(editPrompt, phases); }}>×</button></div>)}</div> : <p className="phase-empty">No phases defined. Add motion beats to generate an animation.</p>}</div>
    <div className="editor-layout">
      <section className="preview-panel editor-panel"><div className="panel-header"><div><span className="eyebrow">PREVIEW</span><span className="preview-resolution">{frameWidth} × {frameHeight}</span></div><div className="playback-tools"><button className="small-tool" onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))} disabled={!frames.length}>‹</button><button className="play-button" onClick={() => { if (activeIndex === frames.length - 1 && !loop) setActiveIndex(0); setPlaying(!playing); }} disabled={frames.length < 2}>{playing ? "Ⅱ" : "▶"}</button><button className="small-tool" onClick={() => setActiveIndex(Math.min(frames.length - 1, activeIndex + 1))} disabled={!frames.length}>›</button></div></div>
        <div className="preview-canvas-controls"><label>Background <select value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value as typeof previewBackground)}><option value="checkerboard">Checkerboard</option><option value="solid">Solid</option><option value="transparent">Transparent</option></select></label><button aria-label="Zoom out" onClick={() => setPreviewZoom((zoom) => Math.max(1, zoom / 2))}>−</button><span>{previewZoom}×</span><button aria-label="Zoom in" onClick={() => setPreviewZoom((zoom) => Math.min(8, zoom * 2))}>＋</button><button onClick={() => setPreviewZoom(1)}>Native size</button><label className="frame-difference"><input type="checkbox" checked={inspectDifference} onChange={(event) => setInspectDifference(event.target.checked)} /> Difference</label><button disabled={!frames.length} onClick={() => { setPlaying(false); setAnimating(false); setActiveIndex(frames.length - 1); setInspectDifference(true); }}>Loop seam</button>{differencePercent !== null && <span>{differencePercent}% changed</span>}</div>
        <div className="frame-alignment-tools"><label>Alignment mode<select disabled={!activeFrame} value={alignmentMode} onChange={(event) => setAlignmentMode(event.target.value as typeof alignmentMode)}><option value="manual">Manual</option><option value="center">Canvas center</option><option value="grounded">Grounded / baseline</option><option value="custom-pivot">Custom pivot</option></select></label><button className="text-button" disabled={!activeFrame || alignmentMode === "manual"} onClick={() => void alignFrame()}>Align frame</button><button className="text-button" disabled={!activeFrame || activeIndex === 0} onClick={matchPrevious}>Match previous</button><button className={editingPivot ? "text-button pivot-active" : "text-button"} disabled={!activeFrame} onClick={() => setEditingPivot((value) => !value)}>{editingPivot ? "Done editing pivot" : "Edit pivot"}</button><label className="onion-toggle"><input type="checkbox" checked={onionSkin} onChange={(event) => setOnionSkin(event.target.checked)} /> Onion skin</label></div>
        <div className="placement-selection-tools"><span>Apply placement to:</span>{frames.map((frame, index) => <label key={frame.id}><input type="checkbox" checked={selectedIndices.includes(index)} onChange={(event) => setSelectedIndices((current) => event.target.checked ? [...current, index] : current.filter((item) => item !== index))} />{index + 1}</label>)}<button className="text-button" disabled={!activeFrame || selectedIndices.every((index) => index === activeIndex)} onClick={applyPlacementToSelected}>Apply to selected</button></div>
        <div className={`editor-canvas-wrap ${previewBackground}-preview`}><div className={`editor-canvas ${previewBackground === "checkerboard" ? "checkerboard" : ""} ${previewZoom > 1 ? "zoomed-preview" : ""}`}><canvas style={{ width: `${Math.min(800, 100 * previewZoom)}%`, height: "auto", imageRendering: "pixelated" }} ref={canvasRef} onPointerDown={startDrag} onPointerMove={dragSprite} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} className={activeFrame ? "draggable-canvas" : ""} aria-label={editingPivot ? "Click or drag to set frame pivot" : "Sprite frame preview; drag to recenter"} />{!frames.length && <div className="canvas-empty"><span>＋</span><strong>Import animation frames</strong><small>PNG, JPG, or WebP</small></div>}</div></div>
        <div className="align-tools"><div className="align-label"><strong>Placement</strong><span>{editingPivot ? "Click or drag to move pivot" : "Drag or use arrow keys · Shift = 10 px"}</span></div><div className="nudge-pad"><button onClick={() => nudge(0, -1)} disabled={!activeFrame} aria-label="Nudge up">↑</button><button onClick={() => nudge(-1, 0)} disabled={!activeFrame} aria-label="Nudge left">←</button><button onClick={() => nudge(0, 1)} disabled={!activeFrame} aria-label="Nudge down">↓</button><button onClick={() => nudge(1, 0)} disabled={!activeFrame} aria-label="Nudge right">→</button></div><div className="offset-readout">{activeFrame ? `X ${activeFrame.offsetX} · Y ${activeFrame.offsetY}` : "X 0 · Y 0"}</div><button className="text-button reset-placement" onClick={() => activeFrame && changeActiveFrame((frame) => ({ ...frame, offsetX: 0, offsetY: 0 }))} disabled={!activeFrame}>Reset</button><label className="sheet-layout-control">Sheet layout<select value={sheetLayout} onChange={(event) => setSheetLayout(event.target.value as FrameLayout)}><option value="horizontal">Horizontal</option><option value="grid">Grid</option></select></label><label className="sheet-padding-control">Padding<input type="number" min="0" max="128" value={sheetPadding} onChange={(event) => setSheetPadding(Math.max(0, Math.min(128, Number(event.target.value) || 0)))} /></label></div>
        <div className="frame-export-tools"><button className="text-button" disabled={!frames.length || exportBusy} onClick={() => void exportFrameZip()}>{exportBusy ? "Exporting…" : "Frames ZIP"}</button><button className="text-button" disabled={!frames.length || exportBusy} onClick={() => void exportAnimation("gif")}>GIF</button><button className="text-button" disabled={!frames.length || exportBusy} onClick={() => void exportAnimation("webp")}>Animated WebP</button><button className="text-button" disabled={!frames.length || exportBusy} onClick={() => void exportAnimation("apng")}>APNG</button></div>
      </section>
      <aside className="frame-settings"><div className="panel-header"><span className="eyebrow">ANIMATION SETTINGS</span></div><div className="selected-pose-setting"><span>Starting pose</span><div className="pose-setting-content">{startPoseUrl && <img src={startPoseUrl} alt="Prepared animation start pose" />}<div>{card.startPoseImageKey ? <><strong>Prepared pose attached</strong><button className="text-button" onClick={() => poseInputRef.current?.click()}>Replace</button></> : <><strong>Project anchor</strong><button className="text-button" onClick={() => poseInputRef.current?.click()}>Prepare pose</button></>}</div></div><input ref={poseInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden-file" onChange={(event) => { onSavePreparedPose(event.target.files?.[0]); event.currentTarget.value = ""; }} /><small>Use a pose matching the first moment of this animation.</small></div><label className="setting-field">Frame rate <div className="input-suffix"><input type="number" min="1" max="60" value={fps} onChange={(event) => setFps(Math.max(1, Number(event.target.value) || 1))} /><span>FPS</span></div></label><label className="toggle-row"><span><strong>Loop animation</strong><small>Repeat playback continuously</small></span><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /></label><div className="setting-divider"/><div className="eyebrow">SELECTED FRAME</div><div className="selected-frame-info"><span>Frame</span><strong>{frames.length ? `${String(activeIndex + 1).padStart(2, "0")} / ${String(frames.length).padStart(2, "0")}` : "—"}</strong></div><div className="selected-frame-info"><span>Duration</span><label className="duration-input"><input type="number" min="1" value={activeFrame?.durationMs ?? Math.round(1000 / Math.max(fps, 1))} disabled={!activeFrame} onChange={(event) => activeFrame && changeActiveFrame((frame) => ({ ...frame, durationMs: Math.max(1, Number(event.target.value) || 1) }))} /><small>ms</small></label></div><button className="button secondary frame-export" onClick={() => void exportCurrentFrame()} disabled={!activeFrame}>↓ Export selected PNG</button><div className="storage-note"><span>●</span> Frame edits are saved locally.</div></aside>
    </div>
    <div className="timeline-panel"><div className="timeline-heading"><div><span className="eyebrow">TIMELINE</span><span className="frame-count">{frames.length} frames</span></div><button className="text-button" onClick={() => fileInputRef.current?.click()}>＋ Add frames</button></div>{frames.length ? <div className="frame-strip">{frames.map((frame, index) => <div key={frame.id} className={`frame-thumb ${index === activeIndex ? "selected" : ""}`} role="button" tabIndex={0} onClick={() => setActiveIndex(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setActiveIndex(index); }}><span className="thumb-image checkerboard">{imageUrls[frame.imageKey] ? <img src={imageUrls[frame.imageKey]} alt="" /> : <i>?</i>}</span><span className="thumb-index">{String(index + 1).padStart(2, "0")}</span><button className="remove-frame" aria-label={`Remove frame ${index + 1}`} onClick={(event) => { event.stopPropagation(); setFrames((current) => current.filter((item) => item.id !== frame.id)); setActiveIndex((current) => Math.max(0, Math.min(current, frames.length - 2))); }}>×</button></div>)}</div> : <div className="timeline-empty">Import a set of generated frames to edit placement, preview playback, and export a card sprite sheet.</div>}{message && <p className="editor-message" role="status">{message}</p>}</div>
  </section>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button className="icon-button close-button" onClick={onClose} aria-label="Close">×</button></div>{children}</section></div>;
}

export default App;
