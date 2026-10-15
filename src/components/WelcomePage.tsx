import type { StudioProject } from "../types";

export function WelcomePage({
  projects,
  onCreateProject,
  onChooseProject,
  archivedProjects,
  onRestoreProject,
}: {
  projects: StudioProject[];
  onCreateProject: () => void;
  onChooseProject: () => void;
  archivedProjects: StudioProject[];
  onRestoreProject: (project: StudioProject) => void;
}) {
  return (
    <>
      <section className="welcome-page">
        <div className="welcome-glow" />
        <div className="welcome-content">
          <div className="welcome-icon">✳</div>
          <div className="eyebrow">YOUR LOCAL GAME ART WORKSPACE</div>
          <h1>
            Make a world.
            <br />
            <span>One sprite at a time.</span>
          </h1>
          <p>
            Organize characters, animations, and game assets in projects you own. Start with a visual anchor, then build
            a consistent library around it.
          </p>
          <div className="welcome-actions">
            <button className="button primary large" onClick={onCreateProject}>
              <span>＋</span> Create a project
            </button>
            {projects.some((item) => !item.archivedAt) && (
              <button className="button secondary large" onClick={onChooseProject}>
                Open a project
              </button>
            )}
          </div>
          <div className="welcome-hints">
            <span>
              <i>01</i> Create a project
            </span>
            <span>
              <i>02</i> Add an anchor
            </span>
            <span>
              <i>03</i> Build animation cards
            </span>
          </div>
        </div>
        <div className="welcome-art">
          <div className="pixel-star star-one">✦</div>
          <div className="pixel-star star-two">✧</div>
          <div className="pixel-creature">
            <div className="creature-ear left" />
            <div className="creature-ear right" />
            <div className="creature-body">
              <i className="eye left-eye" />
              <i className="eye right-eye" />
              <i className="cheek" />
            </div>
            <div className="creature-foot left-foot" />
            <div className="creature-foot right-foot" />
          </div>
          <div className="art-caption">
            <span className="status-dot" /> YOUR NEXT CHARACTER STARTS HERE
          </div>
        </div>
      </section>
      {archivedProjects.length > 0 && (
        <div className="archived-empty-list">
          <h2>Archived projects</h2>
          {archivedProjects.map((archived) => (
            <div key={archived.id}>
              <span>{archived.name}</span>
              <button className="text-button" onClick={() => onRestoreProject(archived)}>
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
