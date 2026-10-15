import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { GenerationJob, ProviderProfile, SavedSkill, StudioProject } from "../types";
import { WORKSPACE_SCHEMA_VERSION } from "../types";
import { loadWorkspaceAndJobs, saveGenerationJobs, saveWorkspace } from "../imageStore";
import { generationJobSchema, providerProfileSchema, savedSkillSchema, studioProjectSchema } from "../schemas";
import { desktopAvailable, initializeDatabase, syncProjectIndex } from "../database";
import { desktopProjectsDirectory, persistDesktopProjects } from "../desktopFiles";
import { parseSkill, starterSkills } from "../lib/skills";
import { hydrateProjects } from "../lib/hydrateProjects";

const PROJECTS_KEY = "sprite-studio.projects.v1";
const SKILLS_KEY = "sprite-studio.skills.v1";

export function useWorkspacePersistence({
  projects,
  skills,
  activeProjectId,
  providerProfiles,
  activeProviderId,
  generationJobs,
  setProjects,
  setSkills,
  setActiveProjectId,
  setProviderProfiles,
  setActiveProviderId,
  setGenerationJobs,
}: {
  projects: StudioProject[];
  skills: SavedSkill[];
  activeProjectId: string | null;
  providerProfiles: ProviderProfile[];
  activeProviderId: string | null;
  generationJobs: GenerationJob[];
  setProjects: Dispatch<SetStateAction<StudioProject[]>>;
  setSkills: Dispatch<SetStateAction<SavedSkill[]>>;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
  setProviderProfiles: Dispatch<SetStateAction<ProviderProfile[]>>;
  setActiveProviderId: Dispatch<SetStateAction<string | null>>;
  setGenerationJobs: Dispatch<SetStateAction<GenerationJob[]>>;
}) {
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [desktopProjectPath, setDesktopProjectPath] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function initializeWorkspace() {
      try {
        const { workspace: saved, jobs: savedJobs } = await loadWorkspaceAndJobs();
        if (saved) {
          if (cancelled) return;
          const parsedProjects = hydrateProjects(saved.projects).filter(
            (project) => studioProjectSchema.safeParse(project).success
          );
          setProjects(parsedProjects);
          const hydratedSkills = saved.skills.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill));
          setSkills(hydratedSkills.length ? hydratedSkills : starterSkills);
          setActiveProjectId(saved.activeProjectId);
          const providers =
            saved.providers?.profiles
              .map((profile) => providerProfileSchema.safeParse(profile))
              .filter((result) => result.success)
              .map((result) => result.data) ?? [];
          setProviderProfiles(providers);
          setActiveProviderId(saved.providers?.activeProfileId ?? providers[0]?.id ?? null);
          const restoredJobs = savedJobs
            .map((job) => generationJobSchema.safeParse(job))
            .filter((result) => result.success)
            .map((result) => result.data);
          setGenerationJobs(
            restoredJobs.map((job) =>
              job.status === "running" || job.status === "queued"
                ? {
                    ...job,
                    status: "failed",
                    progress: 0,
                    error: "App closed before the request completed. Retry the job.",
                    updatedAt: new Date().toISOString(),
                  }
                : job
            )
          );
        } else {
          const legacyProjects = hydrateProjects(JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]")).filter(
            (project) => studioProjectSchema.safeParse(project).success
          );
          const legacySkillsRaw: unknown = JSON.parse(localStorage.getItem(SKILLS_KEY) ?? "null");
          const legacySkills = Array.isArray(legacySkillsRaw)
            ? legacySkillsRaw.map(parseSkill).filter((skill): skill is SavedSkill => Boolean(skill))
            : [];
          const activeProject = JSON.parse(localStorage.getItem("sprite-studio.activeProject.v1") ?? "null") as
            string | null;
          const initial = {
            schemaVersion: 1 as const,
            projects: legacyProjects,
            skills: legacySkills.length ? legacySkills : starterSkills,
            activeProjectId: activeProject,
            providers: { profiles: [], activeProfileId: null },
          };
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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceLoaded) return;
    const checkedProjects = projects.map((project) => studioProjectSchema.safeParse(project));
    const checkedSkills = skills.map((skill) => savedSkillSchema.safeParse(skill));
    const invalidProject = checkedProjects.find((result) => !result.success);
    const invalidSkill = checkedSkills.find((result) => !result.success);
    if (invalidProject && !invalidProject.success) {
      const issue = invalidProject.error.issues[0];
      setWorkspaceError(
        `Project data failed validation${issue?.path.length ? ` at ${issue.path.join(".")}` : ""}: ${issue?.message ?? "invalid project"}`
      );
      return;
    }
    if (invalidSkill && !invalidSkill.success) {
      setWorkspaceError(`Skill data failed validation: ${invalidSkill.error.issues[0]?.message ?? "invalid skill"}`);
      return;
    }
    void Promise.all([
      saveWorkspace({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        projects,
        skills,
        activeProjectId,
        providers: { profiles: providerProfiles, activeProfileId: activeProviderId },
      }),
      saveGenerationJobs(generationJobs),
      syncProjectIndex(projects),
      ...(desktopAvailable() ? [persistDesktopProjects(projects)] : []),
    ])
      .then(() => setWorkspaceError(""))
      .catch((error: unknown) => {
        setWorkspaceError(error instanceof Error ? error.message : "Could not save local workspace.");
      });
  }, [workspaceLoaded, projects, skills, activeProjectId, providerProfiles, activeProviderId, generationJobs]);

  useEffect(() => {
    if (!workspaceLoaded || !desktopAvailable()) return;
    void desktopProjectsDirectory()
      .then(setDesktopProjectPath)
      .catch((error: unknown) =>
        setWorkspaceError(error instanceof Error ? error.message : "Could not locate the project folder on disk.")
      );
  }, [workspaceLoaded]);

  useEffect(() => {
    void initializeDatabase().catch((error: unknown) =>
      setWorkspaceError(error instanceof Error ? error.message : "Could not initialize local database.")
    );
  }, []);
  return { workspaceLoaded, workspaceError, desktopProjectPath };
}
