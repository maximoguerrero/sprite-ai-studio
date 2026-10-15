import type { GenerationJob } from "../types";
import { generationJobLabel } from "../lib/jobLabels";

export function GenerationJobPanel({
  jobs,
  onCancel,
  onRetry,
  onClose,
}: {
  jobs: GenerationJob[];
  onCancel: (id: string) => void;
  onRetry: (job: GenerationJob) => void;
  onClose: () => void;
}) {
  const visibleJobs = jobs.slice(0, 8);
  return (
    <aside className="generation-job-panel" aria-label="Generation jobs">
      <div className="generation-job-heading">
        <strong>Generation jobs</strong>
        <span>{jobs.filter((job) => job.status === "running" || job.status === "queued").length} active</span>
        <button
          type="button"
          className="generation-job-close"
          aria-label="Close generation jobs"
          title="Close generation jobs"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {visibleJobs.map((job) => (
        <div className="generation-job" key={job.id}>
          <div className="generation-job-main">
            <span className={`job-state ${job.status}`} />
            <div>
              <strong>{generationJobLabel(job)}</strong>
              <small>
                {job.status === "failed" || job.status === "cancelled"
                  ? (job.error ?? job.status)
                  : `${job.status} · ${job.progress}%`}
              </small>
            </div>
          </div>
          {job.status === "running" || job.status === "queued" ? (
            <button onClick={() => onCancel(job.id)}>Cancel</button>
          ) : job.status === "failed" || job.status === "cancelled" ? (
            <button onClick={() => onRetry(job)}>Retry</button>
          ) : (
            <span className="job-done">Done</span>
          )}
        </div>
      ))}
    </aside>
  );
}
