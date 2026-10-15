import type { Dispatch, SetStateAction } from "react";
import type { SavedSkill, StudioProject } from "../types";

export function SkillsPage({
  activeProject,
  search,
  setSearch,
  filteredSkills,
  skillImportMessage,
  skillFileInput,
  setSkillFileInput,
  onImport,
  onExport,
  onExportMarkdown,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  activeProject: StudioProject | null;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  filteredSkills: SavedSkill[];
  skillImportMessage: string;
  skillFileInput: HTMLInputElement | null;
  setSkillFileInput: Dispatch<SetStateAction<HTMLInputElement | null>>;
  onImport: (file?: File) => Promise<void>;
  onExport: () => void;
  onExportMarkdown: () => void;
  onEdit: (skill?: SavedSkill) => void;
  onDuplicate: (skill: SavedSkill) => void;
  onDelete: (skill: SavedSkill) => void;
}) {
  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">PROMPT RECIPES</div>
          <h1>Skills library</h1>
          <p>Reusable prompt templates and generation settings, ready for any project.</p>
        </div>
        <div className="skills-page-actions">
          <input
            ref={setSkillFileInput}
            type="file"
            accept="application/json,.json,text/markdown,.md"
            className="hidden-file"
            onChange={(event) => {
              void onImport(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <div className="skill-export-menu">
            <button className="button secondary" onClick={onExport}>
              Export JSON
            </button>
            <button className="button secondary" onClick={onExportMarkdown}>
              Export Markdown
            </button>
            <button className="button secondary" onClick={() => skillFileInput?.click()}>
              Import
            </button>
          </div>
          <button className="button primary" onClick={() => onEdit()}>
            <span>＋</span> Create skill
          </button>
        </div>
      </div>
      {activeProject && (
        <div className="skill-scope-tabs">
          <span>Showing skills for:</span>
          <strong>{activeProject.name}</strong>
          <span>and Global</span>
        </div>
      )}
      <div className="toolbar">
        <label className="search-box">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search skills" />
        </label>
        <span className="result-count">{filteredSkills.length} skills</span>
      </div>
      {skillImportMessage && (
        <p className="skill-import-message" role="status">
          {skillImportMessage}
        </p>
      )}
      <div className="skill-grid">
        {filteredSkills.map((skill) => (
          <article className="skill-card" key={skill.id}>
            <div className="skill-card-top">
              <span className="skill-icon">✧</span>
              <span className="tag">{skill.projectId ? "project" : "global"}</span>
              <span className="tag">{skill.category}</span>
            </div>
            <h3>{skill.name}</h3>
            <p>{skill.description || skill.promptTemplate}</p>
            <div className="skill-defaults">
              {skill.defaults.size && <span>{skill.defaults.size} px</span>}
              {skill.defaults.fps && <span>{skill.defaults.fps} FPS</span>}
              {skill.defaults.frameCount && <span>{skill.defaults.frameCount} frames</span>}
              {skill.defaults.loop !== undefined && <span>{skill.defaults.loop ? "Loop" : "One-shot"}</span>}
            </div>
            <div className="skill-card-footer">
              <span>Updated {skill.updatedAt}</span>
              <div className="skill-actions">
                <button onClick={() => onEdit(skill)}>Edit</button>
                <button onClick={() => onDuplicate(skill)}>Duplicate</button>
                <button onClick={() => onDelete(skill)}>Delete</button>
              </div>
            </div>
          </article>
        ))}
        {filteredSkills.length === 0 && (
          <div className="empty-state small-empty">
            <span className="empty-icon">✧</span>
            <h3>No skills found</h3>
            <p>Try a different search or create a reusable prompt skill.</p>
          </div>
        )}
      </div>
    </section>
  );
}
