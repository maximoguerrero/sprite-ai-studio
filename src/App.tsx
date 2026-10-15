import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderProfile, StudioProject } from "./types";
import { resolveCardCanvas } from "./productFoundation";
import { imageModelFor } from "./openAIProvider";
import { Sidebar, type AppView } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Dialog } from "./components/Dialog";
import { GenerationConfirmDialog } from "./components/GenerationConfirmDialog";
import { ThemeSettings } from "./components/ThemeSettings";
import { useThemePreferences } from "./hooks/useThemePreferences";
import { useProviderSettings } from "./hooks/useProviderSettings";
import {
  defaultImageModelChoice,
  imageModelChoiceId,
  parseImageModelChoice,
  useImageModelCatalog,
  type ImageModelRequirement,
} from "./hooks/useImageModelCatalog";
import { useSkillLibrary } from "./hooks/useSkillLibrary";
import { useGenerationJobs } from "./hooks/useGenerationJobs";
import { useCardActions } from "./hooks/useCardActions";
import { useGenerationActions } from "./hooks/useGenerationActions";
import { useProjectActions } from "./hooks/useProjectActions";
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence";
import { useCardDraft } from "./hooks/useCardDraft";
import { GenerationJobPanel } from "./components/GenerationJobPanel";
import { SkillForm } from "./components/SkillForm";
import { CreateProjectDialog } from "./components/CreateProjectDialog";
import { CreateCardDialog } from "./components/CreateCardDialog";
import { SkillsPage } from "./components/SkillsPage";
import { SettingsPage } from "./components/SettingsPage";
import { ProjectExportDialog } from "./components/ProjectExportDialog";
import { StillAssetEditor } from "./components/StillAssetEditor";
import { FrameEditor } from "./components/FrameEditor";
import { Workspace } from "./components/Workspace";

function App() {
  const { customThemes, setCustomThemes, theme, setTheme } = useThemePreferences();
  const {
    providerProfiles,
    setProviderProfiles,
    activeProviderId,
    setActiveProviderId,
    providerBusy,
    providerMessage,
    setProviderMessage,
    providerModels,
    setProviderModels,
    providerModelDetails,
    providerDraftType,
    activeProvider,
    toggleProviderEnabled,
    createProviderDraft,
    saveProvider,
    testActiveProvider,
    loadProviderModels,
    deleteActiveProvider,
  } = useProviderSettings();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("workspace");
  const [dialog, setDialog] = useState<"project" | "animation" | "asset" | "skill" | null>(null);
  const [search, setSearch] = useState("");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [projectExportOpen, setProjectExportOpen] = useState(false);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [foundationNotice, setFoundationNotice] = useState("");
  const [missingImageKeys, setMissingImageKeys] = useState<string[]>([]);
  const [isGeneratingAnchor, setIsGeneratingAnchor] = useState(false);
  const [generatingCardId, setGeneratingCardId] = useState<string | null>(null);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const enabledProfiles = providerProfiles.filter((profile) => profile.enabled !== false);
  const imageProvider =
    activeProvider && activeProvider.enabled !== false && activeProvider.modelKind !== "text"
      ? activeProvider
      : (enabledProfiles.find((profile) => profile.modelKind !== "text") ?? null);
  const imageModelCatalog = useImageModelCatalog(providerProfiles);
  const selectedImageModel = imageProvider ? imageModelChoiceId(imageProvider.id, imageModelFor(imageProvider)) : "";

  function chooseImageModel(value: string) {
    const choice = parseImageModelChoice(value);
    if (!choice) return;
    const profile = providerProfiles.find((item) => item.id === choice.profileId);
    if (!profile) return;
    setActiveProviderId(choice.profileId);
    setProviderProfiles((current) =>
      current.map((item) =>
        item.id === choice.profileId ? { ...item, imageModel: choice.model, updatedAt: new Date().toISOString() } : item
      )
    );
    setFoundationNotice(`Image generation will use “${choice.model}” from “${profile.name}”.`);
  }
  const activeCard = activeProject?.cards.find((card) => card.id === activeCardId) ?? null;
  const {
    skills,
    setSkills,
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
    saveCardAsSkill,
    rewriteSkillPrompt,
    rewriteCardPrompt,
    rewriteMotionPrompt,
  } = useSkillLibrary({ projects, setProjects, setDialog, activeProject, providerProfiles });
  const { generationJobs, setGenerationJobs, makeGenerationJob, enqueueGeneration, cancelGeneration, retryGeneration } =
    useGenerationJobs({
      providerProfiles,
      projects,
      setProjects,
      setFoundationNotice,
      setIsGeneratingAnchor,
      setGeneratingCardId,
    });
  const [showGenerationJobs, setShowGenerationJobs] = useState(false);

  const { workspaceLoaded, workspaceError, desktopProjectPath } = useWorkspacePersistence({
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
  });

  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const {
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
  } = useCardActions({
    setProjects,
    setFoundationNotice,
    setGenerationJobs,
    activeCardId,
    setActiveCardId,
    activeProjectId,
    activeProject,
    projectsRef,
  });

  const [generationConfirm, setGenerationConfirm] = useState<{
    title: string;
    message: string;
    requirement: ImageModelRequirement;
    actionLabel?: string;
    resolve: (choice: { provider: ProviderProfile; model: string } | null) => void;
  } | null>(null);

  const confirmGeneration = useCallback(
    (options: { title?: string; message: string; requirement?: ImageModelRequirement; actionLabel?: string }) =>
      new Promise<{ provider: ProviderProfile; model: string } | null>((resolve) => {
        setGenerationConfirm({
          title: options.title ?? "Confirm generation",
          message: options.message,
          requirement: options.requirement ?? "image",
          ...(options.actionLabel ? { actionLabel: options.actionLabel } : {}),
          resolve,
        });
      }),
    []
  );

  const {
    generateAnchor,
    generateAssetForCard,
    generateAnimationCard,
    generateInBetweenFrame,
    generateVideoAnimation,
    editAnchorImage,
    touchUpFrameWithAI,
  } = useGenerationActions({
    activeProject,
    activeProvider: imageProvider,
    setActiveView,
    setFoundationNotice,
    setProviderMessage,
    updateCard,
    confirmGeneration,
    makeGenerationJob,
    enqueueGeneration,
  });

  const {
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
    handleCreateProject,
  } = useProjectActions({
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
  });

  const projectSkills = activeProject?.skills ?? [];
  const availableSkills = [...skills, ...projectSkills];
  const {
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
  } = useCardDraft({ activeProject, dialog, setDialog, availableSkills, setProjects, setFoundationNotice });

  const filteredSkills = useMemo(
    () =>
      availableSkills.filter((skill) =>
        `${skill.name} ${skill.category} ${skill.projectId ? (activeProject?.name ?? "project") : "global"}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [skills, projectSkills, search, activeProject?.name]
  );

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        skillCount={skills.length + (activeProject?.skills?.length ?? 0)}
        activeProjectId={activeProjectId}
        activeView={activeView}
        onViewChange={setActiveView}
        onProjectSelect={(id) => {
          setActiveProjectId(id);
          setActiveView("workspace");
        }}
        onCreateProject={() => setDialog("project")}
      />

      <main className="main-area">
        <Topbar
          activeView={activeView}
          projectName={activeProject?.name}
          providerConfigured={Boolean(imageProvider)}
          imageModelGroups={imageModelCatalog.groups}
          selectedImageModel={selectedImageModel}
          onImageModelChange={chooseImageModel}
          onImageModelRefresh={() => void imageModelCatalog.refresh()}
          imageModelsLoading={Boolean(imageModelCatalog.loadingProfileId)}
        />

        {workspaceError && (
          <div className="workspace-notice" role="status">
            Local workspace: {workspaceError}
          </div>
        )}
        {foundationNotice && (
          <div className="workspace-notice" role="status">
            {foundationNotice}
          </div>
        )}
        {activeView === "settings" && desktopProjectPath && (
          <div className="disk-save-location">
            <strong>Desktop project storage</strong>
            <span>Generated images and project files save automatically to</span>
            <code>{desktopProjectPath}/&lt;project-slug&gt;</code>
          </div>
        )}
        {activeView === "settings" && (
          <ThemeSettings
            theme={theme}
            customThemes={customThemes}
            onChange={setTheme}
            onSaveCustomTheme={(updated) =>
              setCustomThemes((current) => [updated, ...current.filter((item) => item.id !== updated.id)])
            }
            onDeleteCustomTheme={(id) => setCustomThemes((current) => current.filter((item) => item.id !== id))}
          />
        )}
        {!workspaceLoaded ? (
          <div className="workspace-loading">Loading local workspace…</div>
        ) : (
          activeView === "workspace" &&
          (activeCard && activeProject ? (
            activeCard.kind === "asset" ? (
              <StillAssetEditor
                key={activeCard.id}
                card={activeCard}
                canvasSize={resolveCardCanvas(activeProject, activeCard)}
                hasAnchor={Boolean(activeProject.anchorVersionId)}
                anchorImageKey={
                  activeProject.anchorVersions?.find(
                    (version) => version.id === (activeCard.anchorVersionId ?? activeProject.anchorVersionId)
                  )?.imageKey
                }
                availableSkills={availableSkills}
                onClose={() => setActiveCardId(null)}
                onUpdate={(update) =>
                  updateCard(activeProject.id, activeCard.id, (current) => ({ ...current, ...update }))
                }
                onGenerate={() => void generateAssetForCard(activeCard)}
                generating={generatingCardId === activeCard.id}
                onDelete={() => void deleteCard(activeProject, activeCard)}
                onRewritePrompt={rewriteCardPrompt}
                onDeleteLayer={(layerId) => void deleteAssetLayer(activeProject, activeCard, layerId)}
                onSelectVersion={(version) => void selectAssetVersion(activeProject, activeCard, version)}
                onGenerateVideo={() => void generateVideoAnimation(activeCard)}
                onDeleteVideo={(video) => void deleteVideoClip(activeProject, activeCard, video)}
              />
            ) : (
              <FrameEditor
                key={activeCard.id}
                card={activeCard}
                canvasSize={{ width: 256, height: 256 }}
                onClose={() => setActiveCardId(null)}
                onSave={(frames, fps, loop) => saveCardFrames(activeCard.id, frames, fps, loop)}
                onSaveAsSkill={(settings) =>
                  saveCardAsSkill(activeCard, { ...settings, size: activeCard.size ?? activeProject.size })
                }
                onSaveCardSettings={(settings) => {
                  if (settings.phases)
                    updateAnimationVersion(activeProject.id, activeCard.id, (version) => ({
                      ...version,
                      phases: settings.phases!,
                    }));
                  updateCard(activeProject.id, activeCard.id, (card) => ({ ...card, ...settings }));
                }}
                onSavePromptAndPhases={(prompt, phases) => saveCardPromptAndPhases(activeCard.id, prompt, phases)}
                onRewriteMotionPrompt={rewriteMotionPrompt}
                onRename={(name) => applyCardRename(activeProject, activeCard, name)}
                onGenerateAnimation={() => void generateAnimationCard(activeCard)}
                onGenerateVideo={() => void generateVideoAnimation(activeCard)}
                onDeleteVideo={(video) => void deleteVideoClip(activeProject, activeCard, video)}
                onGenerateInBetween={(before, after) => generateInBetweenFrame(activeCard, before, after)}
                onRevertFrameEdit={(frame) => void revertFrameEdit(activeProject, activeCard, frame)}
                onAiTouchUp={(frame, prompt, choice) => {
                  const parsed = parseImageModelChoice(choice);
                  const profile = parsed ? providerProfiles.find((item) => item.id === parsed.profileId) : undefined;
                  void touchUpFrameWithAI(
                    activeCard,
                    frame,
                    prompt,
                    profile && parsed ? { provider: profile, model: parsed.model } : undefined
                  );
                }}
                imageModelGroups={imageModelCatalog.groups}
                defaultImageModel={selectedImageModel}
                onSelectVersion={(version) => selectAnimationVersion(activeProject.id, activeCard.id, version)}
                onDeleteVersion={(version) => void deleteAnimationVersion(activeProject, activeCard, version)}
                onDelete={() => void deleteCard(activeProject, activeCard)}
              />
            )
          ) : (
            <Workspace
              projects={projects}
              project={activeProject}
              projectDiskPath={
                activeProject
                  ? desktopProjectPath
                    ? `${desktopProjectPath}/${activeProject.slug}`
                    : `Browser workspace (IndexedDB) · ${activeProject.folderPath}`
                  : ""
              }
              onCreateProject={() => setDialog("project")}
              onSelectProject={(id) => {
                setActiveProjectId(id);
                setActiveCardId(null);
              }}
              onChooseProject={chooseActiveProject}
              onCreateCard={showCardDialog}
              onAnchor={updateAnchor}
              onOpenCard={setActiveCardId}
              onProjectExport={() => setProjectExportOpen(true)}
              onRenameProject={renameProject}
              onArchiveProject={archiveProject}
              onRestoreProject={restoreProject}
              archivedProjects={projects.filter((project) => Boolean(project.archivedAt))}
              showArchived={showArchivedProjects}
              onToggleArchived={() => setShowArchivedProjects((value) => !value)}
              onGenerateAnchor={(prompt) => void generateAnchor(prompt)}
              onEditAnchor={editAnchorImage}
              isGeneratingAnchor={isGeneratingAnchor}
              onSelectAnchorVersion={(version) => activeProject && selectAnchorVersion(activeProject.id, version)}
              onDeleteAnchorVersion={(version) => activeProject && void deleteAnchorVersion(activeProject, version)}
              onUpdateAnchorMetadata={(field, value) =>
                activeProject && updateAnchorMetadata(activeProject.id, field, value)
              }
              onGenerateAsset={(card) => void generateAssetForCard(card)}
              generatingCardId={generatingCardId}
              providerConfigured={Boolean(imageProvider?.apiKeyConfigured)}
              onGenerateAnimation={(card) => void generateAnimationCard(card)}
              onRenameCard={renameCard}
              onDuplicateCard={duplicateCard}
              onMoveCard={moveCard}
              onArchiveCard={archiveCard}
              onRestoreCard={restoreCard}
              onDeleteCard={deleteCard}
            />
          ))
        )}
        {activeView === "workspace" && showGenerationJobs && generationJobs.length > 0 && (
          <GenerationJobPanel
            jobs={generationJobs}
            onCancel={cancelGeneration}
            onRetry={retryGeneration}
            onClose={() => setShowGenerationJobs(false)}
          />
        )}
        {activeView === "workspace" && !showGenerationJobs && generationJobs.length > 0 && (
          <button className="show-generation-jobs" onClick={() => setShowGenerationJobs(true)}>
            Show generation jobs{" "}
            <span>
              {generationJobs.filter((job) => job.status === "running" || job.status === "queued").length} active
            </span>
          </button>
        )}
        {activeView === "workspace" && !activeProject && !activeCard && (
          <div className="workspace-project-picker">
            <h2>Choose a project</h2>
            {projects
              .filter((project) => !project.archivedAt)
              .map((project) => (
                <button key={project.id} onClick={() => setActiveProjectId(project.id)}>
                  {project.name}
                  <span>{project.cards.length} cards</span>
                </button>
              ))}
          </div>
        )}
        {activeView === "skills" && (
          <SkillsPage
            activeProject={activeProject}
            search={search}
            setSearch={setSearch}
            filteredSkills={filteredSkills}
            skillImportMessage={skillImportMessage}
            skillFileInput={skillFileInput}
            setSkillFileInput={setSkillFileInput}
            onImport={importSkills}
            onExport={exportSkills}
            onExportMarkdown={exportSkillsMarkdown}
            onEdit={openSkillEditor}
            onDuplicate={duplicateSkill}
            onDelete={deleteSkill}
          />
        )}
        {activeView === "settings" && (
          <SettingsPage
            activeProject={activeProject}
            profiles={providerProfiles}
            activeProfile={activeProvider}
            activeProfileId={activeProviderId}
            draftType={providerDraftType}
            models={providerModels}
            modelDetails={providerModelDetails}
            busy={providerBusy}
            message={providerMessage}
            onChoose={(id) => {
              setActiveProviderId(id);
              setProviderModels([]);
              setProviderMessage("");
            }}
            onSave={saveProvider}
            onTest={testActiveProvider}
            onLoadModels={loadProviderModels}
            onDelete={deleteActiveProvider}
            onNew={createProviderDraft}
            onToggleEnabled={toggleProviderEnabled}
            onExportWorkspaceBackup={exportWorkspaceBackup}
            onRestoreWorkspaceBackup={restoreWorkspaceBackup}
            onImportProjectArchive={importProjectArchive}
            onExportProjectArchive={exportProjectArchive}
            onChooseProjectDirectory={chooseProjectDirectory}
            missingImageKeys={missingImageKeys}
            onRecoverMissingImage={recoverMissingImage}
            foundationNotice={foundationNotice}
          />
        )}
      </main>

      {dialog && (
        <Dialog
          title={
            dialog === "project"
              ? "Create a project"
              : dialog === "skill"
                ? "Create a reusable skill"
                : dialog === "animation"
                  ? "New animation card"
                  : "New asset card"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "project" && (
            <CreateProjectDialog onSubmit={handleCreateProject} onClose={() => setDialog(null)} />
          )}
          {(dialog === "animation" || dialog === "asset") && (
            <CreateCardDialog
              kind={dialog}
              activeProject={activeProject}
              availableSkills={availableSkills}
              draftAnimationPreset={draftAnimationPreset}
              setDraftAnimationPreset={setDraftAnimationPreset}
              draftPrompt={draftPrompt}
              setDraftPrompt={setDraftPrompt}
              draftLoop={draftLoop}
              setDraftLoop={setDraftLoop}
              draftPhases={draftPhases}
              setDraftPhases={setDraftPhases}
              draftSkillId={draftSkillId}
              setDraftSkillId={setDraftSkillId}
              skillVariables={skillVariables}
              setSkillVariables={setSkillVariables}
              onSubmit={createCard}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog === "skill" && (
            <SkillForm
              key={editingSkill?.id ?? "new-skill"}
              skill={editingSkill}
              activeProject={activeProject}
              onSubmit={saveSkill}
              onCancel={() => {
                setEditingSkill(null);
                setDialog(null);
              }}
              onRewrite={rewriteSkillPrompt}
            />
          )}
        </Dialog>
      )}
      {projectExportOpen && activeProject && (
        <ProjectExportDialog project={activeProject} onClose={() => setProjectExportOpen(false)} />
      )}
      {generationConfirm && (
        <GenerationConfirmDialog
          title={generationConfirm.title}
          message={generationConfirm.message}
          groups={imageModelCatalog.groups}
          requirement={generationConfirm.requirement}
          defaultValue={defaultImageModelChoice(
            imageModelCatalog.groups,
            generationConfirm.requirement,
            selectedImageModel
          )}
          {...(generationConfirm.actionLabel ? { actionLabel: generationConfirm.actionLabel } : {})}
          onConfirm={(choiceId) => {
            const parsed = parseImageModelChoice(choiceId);
            const profile = parsed ? providerProfiles.find((item) => item.id === parsed.profileId) : undefined;
            generationConfirm.resolve(profile && parsed ? { provider: profile, model: parsed.model } : null);
            setGenerationConfirm(null);
          }}
          onCancel={() => {
            generationConfirm.resolve(null);
            setGenerationConfirm(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
