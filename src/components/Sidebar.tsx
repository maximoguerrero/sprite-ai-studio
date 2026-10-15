import type { StudioProject } from "../types";

export type AppView = "workspace" | "skills" | "settings";

type SidebarProps = {
  projects: StudioProject[];
  skillCount: number;
  activeProjectId: string | null;
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  onProjectSelect: (projectId: string) => void;
  onCreateProject: () => void;
};

export function Sidebar({
  projects,
  skillCount,
  activeProjectId,
  activeView,
  onViewChange,
  onProjectSelect,
  onCreateProject,
}: SidebarProps) {
  const recentProjects = projects.filter((project) => !project.archivedAt).slice(0, 6);

  return (
    <aside className="sidebar fixed inset-y-0 left-0 z-10 flex w-[244px] flex-col">
      <a
        className="brand"
        href="#home"
        onClick={(event) => {
          event.preventDefault();
          onViewChange("workspace");
        }}
      >
        <span className="brand-mark">✳</span>
        <span>
          sprite<span className="brand-light">studio</span>
        </span>
      </a>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="primary-nav" aria-label="Main navigation">
        <button
          className={activeView === "workspace" ? "nav-item selected" : "nav-item"}
          onClick={() => onViewChange("workspace")}
        >
          <span>▦</span> Projects <span className="nav-count">{projects.length}</span>
        </button>
        <button
          className={activeView === "skills" ? "nav-item selected" : "nav-item"}
          onClick={() => onViewChange("skills")}
        >
          <span>✧</span> Skills library <span className="nav-count">{skillCount}</span>
        </button>
      </nav>
      <div className="sidebar-section">
        <div className="section-label">
          RECENT PROJECTS{" "}
          <button aria-label="Create project" onClick={onCreateProject}>
            ＋
          </button>
        </div>
        {recentProjects.length === 0 ? (
          <p className="sidebar-empty">Your projects will appear here.</p>
        ) : (
          recentProjects.map((project) => (
            <button
              key={project.id}
              className={`project-link ${project.id === activeProjectId ? "active" : ""}`}
              onClick={() => onProjectSelect(project.id)}
            >
              <span className="project-dot" />
              {project.name}
            </button>
          ))
        )}
      </div>
      <div className="sidebar-bottom">
        <button
          className={activeView === "settings" ? "nav-item selected" : "nav-item"}
          onClick={() => onViewChange("settings")}
        >
          <span>⚙</span> Settings
        </button>
        <div className="local-status">
          <span className="status-dot" /> Local workspace <span className="local-badge">LOCAL</span>
        </div>
      </div>
    </aside>
  );
}
