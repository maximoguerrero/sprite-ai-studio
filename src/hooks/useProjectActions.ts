import type { Dispatch, FormEvent, SetStateAction } from "react";
import { unzipSync, zipSync } from "fflate";
import type { AppView } from "../components/Sidebar";
import type { GenerationJob, SavedSkill, SpriteSize, StudioFrame, StudioProject, WorkspaceExport } from "../types";
import { isWorkspaceExport, WORKSPACE_SCHEMA_VERSION } from "../types";
import {
  clearWorkspaceData,
  listStoredImageKeys,
  loadImages,
  saveGenerationJobs,
  saveImage,
  saveWorkspace,
} from "../imageStore";
import { downloadBlob, safeFilename } from "../spriteSheet";
import { writeDirectory, type WritableDirectoryHandle } from "../productFoundation";
import { studioProjectSchema, workspaceExportSchema } from "../schemas";
import { writeDesktopProject } from "../desktopFiles";
import { blobToDataUrl, dataUrlToBlob } from "../lib/imageUtils";
import { makeId, makeSlug } from "../lib/ids";
import { parseSkill } from "../lib/skills";
import { hydrateProjects } from "../lib/hydrateProjects";

export function useProjectActions({
  projects,
  skills,
  generationJobs,
  setProjects,
  setSkills,
  setGenerationJobs,
  activeProjectId,
  setActiveProjectId,
  setShowArchivedProjects,
  setFoundationNotice,
  setMissingImageKeys,
  setActiveView,
  setDialog,
}: {
  projects: StudioProject[];
  skills: SavedSkill[];
  generationJobs: GenerationJob[];
  setProjects: Dispatch<SetStateAction<StudioProject[]>>;
  setSkills: Dispatch<SetStateAction<SavedSkill[]>>;
  setGenerationJobs: Dispatch<SetStateAction<GenerationJob[]>>;
  activeProjectId: string | null;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
  setShowArchivedProjects: Dispatch<SetStateAction<boolean>>;
  setFoundationNotice: (message: string) => void;
  setMissingImageKeys: Dispatch<SetStateAction<string[]>>;
  setActiveView: Dispatch<SetStateAction<AppView>>;
  setDialog: Dispatch<SetStateAction<"project" | "animation" | "asset" | "skill" | null>>;
}) {
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
      ...(data.get("size") === "custom"
        ? {
            canvasSize: {
              width: Number(data.get("customWidth")) || 64,
              height: Number(data.get("customHeight")) || 64,
            },
          }
        : {}),
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

  function renameProject(project: StudioProject) {
    const name = window.prompt("Project name", project.name)?.trim();
    if (!name || name === project.name) return;
    const slug = makeSlug(name, project.id);
    setProjects((current) =>
      current.map((item) =>
        item.id === project.id
          ? {
              ...item,
              name,
              slug,
              folderPath: `projects/${slug}`,
              cards: item.cards.map((card) => ({
                ...card,
                folderPath: `projects/${slug}/cards/${card.kind === "animation" ? "animations" : "assets"}/${card.slug}`,
              })),
            }
          : item
      )
    );
  }

  function archiveProject(project: StudioProject) {
    if (!window.confirm(`Archive “${project.name}”? You can restore it later.`)) return;
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? { ...item, archivedAt: new Date().toISOString() } : item))
    );
    if (activeProjectId === project.id) setActiveProjectId(null);
  }

  function restoreProject(project: StudioProject) {
    setProjects((current) =>
      current.map((item) => {
        if (item.id !== project.id) return item;
        const { archivedAt: _archivedAt, ...restored } = item;
        return restored;
      })
    );
    setActiveProjectId(project.id);
    setShowArchivedProjects(false);
  }

  function chooseActiveProject() {
    const candidates = projects.filter((project) => !project.archivedAt);
    if (candidates.length === 1) setActiveProjectId(candidates[0].id);
    else {
      const id = window.prompt(
        `Enter a project number to open:\n${candidates.map((item, index) => `${index + 1}. ${item.name}`).join("\n")}`
      );
      const selected = candidates[Number(id) - 1];
      if (selected) {
        setActiveProjectId(selected.id);
        setActiveView("workspace");
      }
    }
  }

  async function exportWorkspaceBackup() {
    try {
      const imageKeys = await listStoredImageKeys();
      const blobs = await loadImages(imageKeys);
      const images: WorkspaceExport["images"] = {};
      await Promise.all(
        Object.entries(blobs).map(async ([key, blob]) => {
          images[key] = { type: blob.type, data: await blobToDataUrl(blob) };
        })
      );
      const backup: WorkspaceExport = {
        format: "sprite-studio-workspace/v1",
        exportedAt: new Date().toISOString(),
        projects,
        skills,
        images,
        generationJobs,
      };
      downloadBlob(
        new Blob([JSON.stringify(backup)], { type: "application/json" }),
        `sprite-studio-backup-${new Date().toISOString().slice(0, 10)}.json`
      );
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
      }
      const blobs = await loadImages([...imageKeys]);
      const types: Record<string, string> = {};
      const imageFiles: Record<string, Uint8Array> = {};
      const missing: string[] = [];
      for (const key of imageKeys) {
        const blob = blobs[key];
        if (!blob) {
          missing.push(key);
          continue;
        }
        imageFiles[`images/${encodeURIComponent(key)}`] = new Uint8Array(await blob.arrayBuffer());
        types[key] = blob.type;
      }
      const missingSet = new Set(missing);
      const miss = (key?: string) => (key && missingSet.has(key) ? `missing:${key}` : key);
      for (const version of archivedProject.anchorVersions ?? []) version.imageKey = miss(version.imageKey)!;
      for (const card of archivedProject.cards) {
        if (card.generatedImageKey) card.generatedImageKey = miss(card.generatedImageKey);
        if (card.referenceImageKey) card.referenceImageKey = miss(card.referenceImageKey);
        card.frames = card.frames?.map((frame) => ({
          ...frame,
          imageKey: miss(frame.imageKey)!,
          ...(frame.editImageKey ? { editImageKey: miss(frame.editImageKey)! } : {}),
        }));
        card.versions = card.versions?.map((version) => ({
          ...version,
          frames: version.frames.map((frame) => ({
            ...frame,
            imageKey: miss(frame.imageKey)!,
            ...(frame.editImageKey ? { editImageKey: miss(frame.editImageKey)! } : {}),
          })),
        }));
        card.assetVersions = card.assetVersions?.map((version) => ({ ...version, imageKey: miss(version.imageKey)! }));
        card.assetLayers = card.assetLayers?.map((layer) => ({ ...layer, imageKey: miss(layer.imageKey)! }));
      }
      const files: Record<string, Uint8Array> = {
        ...imageFiles,
        "project.json": new TextEncoder().encode(JSON.stringify(archivedProject, null, 2)),
      };
      files["images.json"] = new TextEncoder().encode(JSON.stringify(types));
      files["recovery.json"] = new TextEncoder().encode(JSON.stringify(missing));
      if (missing.length)
        setFoundationNotice(
          `Exported project archive with ${missing.length} missing image${missing.length === 1 ? "" : "s"} omitted.`
        );
      else setFoundationNotice(`Project “${project.name}” archived with ${imageKeys.size} images.`);
      downloadBlob(
        new Blob([zipSync(files)], { type: "application/zip" }),
        `${safeFilename(project.name)}.sprite-project.zip`
      );
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not archive the project.");
    }
  }

  async function importProjectArchive(file?: File) {
    if (!file) return;
    try {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer())) as Record<string, Uint8Array>;
      const projectFile = Object.entries(archive).find(
        ([path]) => path.endsWith("/project.json") || path === "project.json"
      );
      if (!projectFile) throw new Error("The archive does not contain a project.json manifest.");
      const project = JSON.parse(new TextDecoder().decode(projectFile[1])) as StudioProject;
      const parsedProject = studioProjectSchema.safeParse(project);
      if (!parsedProject.success) throw new Error("The archive contains invalid project metadata.");
      const imageEntries = Object.entries(archive).filter(([path]) => path.startsWith("images/"));
      const originalMissingKeys = archive["recovery.json"]
        ? (JSON.parse(new TextDecoder().decode(archive["recovery.json"])) as string[])
        : [];
      const imageTypes = archive["images.json"]
        ? (JSON.parse(new TextDecoder().decode(archive["images.json"])) as Record<string, string>)
        : {};
      const imageKeysByPath = new Map<string, string>();
      for (const [path, bytes] of imageEntries) {
        const key = `archive-${makeId()}`;
        const originalKey = decodeURIComponent(path.slice("images/".length));
        const mime = imageTypes[originalKey] || "image/png";
        await saveImage(key, new Blob([bytes], { type: mime }));
        imageKeysByPath.set(originalKey, key);
      }
      for (const key of originalMissingKeys)
        if (key.startsWith("missing:") && !imageKeysByPath.has(key.slice("missing:".length)))
          imageKeysByPath.set(key.slice("missing:".length), key);
      const pathFor = (imageKey: string) =>
        imageKeysByPath.get(imageKey) ?? (imageKey.startsWith("missing:") ? imageKey : `missing:${imageKey}`);
      const nextProject = structuredClone(parsedProject.data);
      for (const card of nextProject.cards) {
        card.slug = makeSlug(card.name, card.id);
        card.frames = (card.frames ?? []).map((frame) => ({
          ...frame,
          imageKey: pathFor(frame.imageKey),
          ...(frame.editImageKey ? { editImageKey: pathFor(frame.editImageKey) } : {}),
        }));
        card.versions = card.versions?.map((version) => ({
          ...version,
          frames: version.frames.map((frame) => ({
            ...frame,
            imageKey: pathFor(frame.imageKey),
            ...(frame.editImageKey ? { editImageKey: pathFor(frame.editImageKey) } : {}),
          })),
        }));
        card.assetVersions = card.assetVersions?.map((version) => ({
          ...version,
          imageKey: pathFor(version.imageKey),
        }));
        card.assetLayers = card.assetLayers?.map((layer) => ({ ...layer, imageKey: pathFor(layer.imageKey) }));
        if (card.generatedImageKey) card.generatedImageKey = pathFor(card.generatedImageKey);
        if (card.referenceImageKey) card.referenceImageKey = pathFor(card.referenceImageKey);
        card.folderPath = `${project.folderPath}/cards/${card.kind === "animation" ? "animations" : "assets"}/${card.slug}`;
      }
      nextProject.anchorVersions = (nextProject.anchorVersions ?? []).map((version) => ({
        ...version,
        imageKey: pathFor(version.imageKey),
      }));
      const references = [
        ...(nextProject.anchorVersions ?? []).map((version) => version.imageKey),
        ...nextProject.cards.flatMap((card) =>
          [
            card.generatedImageKey,
            card.referenceImageKey,
            ...(card.frames ?? []).flatMap((frame) =>
              frame.editImageKey ? [frame.imageKey, frame.editImageKey] : [frame.imageKey]
            ),
            ...(card.versions ?? []).flatMap((version) =>
              version.frames.flatMap((frame) =>
                frame.editImageKey ? [frame.imageKey, frame.editImageKey] : [frame.imageKey]
              )
            ),
            ...(card.assetVersions ?? []).map((version) => version.imageKey),
            ...(card.assetLayers ?? []).map((layer) => layer.imageKey),
          ].filter((key): key is string => Boolean(key))
        ),
      ];
      const available = new Set(imageKeysByPath.values());
      const missing = [
        ...new Set([
          ...references
            .filter((key) => key.startsWith("missing:") || !available.has(key))
            .map((key) => (key.startsWith("missing:") ? key : `missing:${key}`)),
          ...originalMissingKeys.map((key) => (key.startsWith("missing:") ? key : `missing:${key}`)),
        ]),
      ];
      const missingNames = new Set(
        missing.map((key) => (key.startsWith("missing:") ? key.slice("missing:".length) : key))
      );
      const validKeys = new Set([...available, ...missing, ...missingNames]);
      const valid = (key?: string) => !key || validKeys.has(key);
      for (const anchor of nextProject.anchorVersions ?? [])
        if (!valid(anchor.imageKey)) anchor.imageKey = `missing:${anchor.imageKey}`;
      for (const card of nextProject.cards) {
        const fixFrame = (frame: StudioFrame): StudioFrame => {
          const next: StudioFrame = {
            ...frame,
            imageKey:
              frame.imageKey.startsWith("missing:") || valid(frame.imageKey)
                ? frame.imageKey
                : `missing:${frame.imageKey}`,
          };
          if (next.editImageKey && !next.editImageKey.startsWith("missing:") && !valid(next.editImageKey))
            next.editImageKey = `missing:${next.editImageKey}`;
          return next;
        };
        card.frames = card.frames?.map(fixFrame);
        card.versions = card.versions?.map((version) => ({ ...version, frames: version.frames.map(fixFrame) }));
        card.assetVersions = card.assetVersions?.map((version) =>
          version.imageKey.startsWith("missing:") || valid(version.imageKey)
            ? version
            : { ...version, imageKey: `missing:${version.imageKey}` }
        );
        card.assetLayers = card.assetLayers?.map((layer) =>
          layer.imageKey.startsWith("missing:") || valid(layer.imageKey)
            ? layer
            : { ...layer, imageKey: `missing:${layer.imageKey}` }
        );
        if (card.generatedImageKey && !card.generatedImageKey.startsWith("missing:") && !valid(card.generatedImageKey))
          card.generatedImageKey = `missing:${card.generatedImageKey}`;
        if (card.referenceImageKey && !card.referenceImageKey.startsWith("missing:") && !valid(card.referenceImageKey))
          card.referenceImageKey = `missing:${card.referenceImageKey}`;
      }
      setMissingImageKeys(missing);
      if (!studioProjectSchema.safeParse(nextProject).success)
        throw new Error("Could not recover this project archive's image references.");
      const collision = projects.some((item) => item.id === nextProject.id || item.slug === nextProject.slug);
      if (collision) {
        nextProject.id = makeId();
        nextProject.slug = makeSlug(`${nextProject.name}-imported`, nextProject.id);
        nextProject.folderPath = `projects/${nextProject.slug}`;
        for (const card of nextProject.cards)
          card.folderPath = `${nextProject.folderPath}/cards/${card.kind === "animation" ? "animations" : "assets"}/${card.slug}`;
      }
      setProjects((current) => [nextProject, ...current]);
      setActiveProjectId(nextProject.id);
      setActiveView("workspace");
      setFoundationNotice(
        `Imported project “${nextProject.name}” and recovered ${imageKeysByPath.size} images.${missing.length ? ` ${missing.length} files need recovery.` : ""}`
      );
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not import the project archive.");
    }
  }

  async function recoverMissingImage(key: string, file?: File) {
    if (!file) return;
    const replacement = key.startsWith("missing:") ? key.slice("missing:".length) : key;
    await saveImage(replacement, file);
    if (key.startsWith("missing:")) {
      setProjects((current) =>
        current.map((project) => ({
          ...project,
          anchorVersions: project.anchorVersions?.map((version) =>
            version.imageKey === key || version.imageKey === replacement
              ? { ...version, imageKey: replacement }
              : version
          ),
          cards: project.cards.map((card) => ({
            ...card,
            generatedImageKey:
              card.generatedImageKey === key || card.generatedImageKey === replacement
                ? replacement
                : card.generatedImageKey,
            referenceImageKey:
              card.referenceImageKey === key || card.referenceImageKey === replacement
                ? replacement
                : card.referenceImageKey,
            frames: card.frames?.map((frame) => {
              const next =
                frame.imageKey === key || frame.imageKey === replacement ? { ...frame, imageKey: replacement } : frame;
              if (next.editImageKey && (next.editImageKey === key || next.editImageKey === replacement))
                return { ...next, editImageKey: replacement };
              return next;
            }),
            versions: card.versions?.map((version) => ({
              ...version,
              frames: version.frames.map((frame) => {
                const next =
                  frame.imageKey === key || frame.imageKey === replacement
                    ? { ...frame, imageKey: replacement }
                    : frame;
                if (next.editImageKey && (next.editImageKey === key || next.editImageKey === replacement))
                  return { ...next, editImageKey: replacement };
                return next;
              }),
            })),
            assetVersions: card.assetVersions?.map((version) =>
              version.imageKey === key || version.imageKey === replacement
                ? { ...version, imageKey: replacement }
                : version
            ),
            assetLayers: card.assetLayers?.map((layer) =>
              layer.imageKey === key || layer.imageKey === replacement ? { ...layer, imageKey: replacement } : layer
            ),
          })),
        }))
      );
    }
    setMissingImageKeys((current) => current.filter((item) => item !== key));
    setFoundationNotice(`Recovered image “${file.name}”.`);
  }

  async function restoreWorkspaceBackup(file?: File) {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validation = workspaceExportSchema.safeParse(parsed);
      if (!validation.success || !isWorkspaceExport(parsed))
        throw new Error("This file is not a valid Sprite Studio workspace backup.");
      const backup = validation.data;
      if (
        !window.confirm(
          `Restore ${backup.projects.length} projects and ${Object.keys(backup.images).length} images? This will replace the current workspace.`
        )
      )
        return;
      await clearWorkspaceData();
      await saveGenerationJobs([]);
      for (const [key, image] of Object.entries(backup.images))
        await saveImage(key, dataUrlToBlob(image.data, image.type));
      const nextProjects = hydrateProjects(backup.projects).filter(
        (project) => studioProjectSchema.safeParse(project).success
      );
      const nextSkills = backup.skills.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill));
      const nextJobs = (backup.generationJobs ?? []).map((job) =>
        job.status === "running" || job.status === "queued"
          ? {
              ...job,
              status: "failed" as const,
              progress: 0,
              error: "Restored from backup before the request completed. Retry this job.",
              updatedAt: new Date().toISOString(),
            }
          : job
      );
      const next = {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        projects: nextProjects,
        skills: nextSkills,
        activeProjectId: nextProjects.find((project) => !project.archivedAt)?.id ?? null,
        generationJobs: nextJobs,
      };
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
        const [{ open }, { join }] = await Promise.all([
          import("@tauri-apps/plugin-dialog"),
          import("@tauri-apps/api/path"),
        ]);
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Choose a folder for Sprite Studio projects",
        });
        if (typeof selected !== "string") return;
        const root = await join(selected, "SpriteStudioProjects");
        for (const project of projects) {
          const keys = [
            ...(project.anchorVersions ?? []).map((version) => version.imageKey),
            ...project.cards.flatMap((card) =>
              (card.frames ?? []).flatMap((frame) =>
                frame.editImageKey ? [frame.imageKey, frame.editImageKey] : [frame.imageKey]
              )
            ),
          ];
          const activeAnchorKey = project.anchorVersions?.find(
            (version) => version.id === project.anchorVersionId
          )?.imageKey;
          const activeAnchorBlob = activeAnchorKey ? (await loadImages([activeAnchorKey]))[activeAnchorKey] : undefined;
          const anchorBlob =
            activeAnchorBlob ??
            (project.anchorPreview
              ? await fetch(project.anchorPreview).then((response) => response.blob())
              : undefined);
          await writeDesktopProject(root, project, await loadImages(keys), anchorBlob);
        }
        setFoundationNotice(`Wrote ${projects.length} project folder${projects.length === 1 ? "" : "s"} to ${root}.`);
      } catch (error) {
        setFoundationNotice(error instanceof Error ? error.message : "Could not write project folders.");
      }
      return;
    }
    const picker = (
      window as Window & {
        showDirectoryPicker?: (options?: { mode?: "readwrite" }) => Promise<WritableDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      setFoundationNotice(
        "Folder export needs a browser with the File System Access API. Download a workspace backup for portable recovery."
      );
      return;
    }
    try {
      const parent = await picker({ mode: "readwrite" });
      for (const project of projects) {
        const destination = await parent.getDirectoryHandle(project.slug, { create: true });
        const keys = [
          ...(project.anchorVersions ?? []).map((version) => version.imageKey),
          ...project.cards.flatMap((card) => [
            ...(card.frames ?? []).flatMap((frame) =>
              frame.editImageKey ? [frame.imageKey, frame.editImageKey] : [frame.imageKey]
            ),
            ...(card.generatedImageKey ? [card.generatedImageKey] : []),
          ]),
        ];
        const activeAnchorKey = project.anchorVersions?.find(
          (version) => version.id === project.anchorVersionId
        )?.imageKey;
        const activeAnchorBlob = activeAnchorKey ? (await loadImages([activeAnchorKey]))[activeAnchorKey] : undefined;
        const anchorBlob =
          activeAnchorBlob ??
          (project.anchorPreview ? await fetch(project.anchorPreview).then((response) => response.blob()) : undefined);
        await writeDirectory(destination, project, await loadImages(keys), anchorBlob);
      }
      setFoundationNotice(
        `Wrote ${projects.length} project folder${projects.length === 1 ? "" : "s"} to the selected location.`
      );
    } catch (error) {
      setFoundationNotice(error instanceof Error ? error.message : "Could not write project folders.");
    }
  }

  return {
    renameProject,
    archiveProject,
    restoreProject,
    chooseActiveProject,
    exportWorkspaceBackup,
    exportProjectArchive,
    importProjectArchive,
    recoverMissingImage,
    restoreWorkspaceBackup,
    chooseProjectDirectory,
    createProject,
    handleCreateProject,
  };
}
