import type { FormEvent } from "react";
import { CanvasSizeFields } from "./CanvasSizeFields";

export function CreateProjectDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        Project name
        <input name="name" placeholder="e.g. Mosswood adventure" required autoFocus />
      </label>
      <CanvasSizeFields name="size" label="Default sprite size" defaultValue="64" />
      <p className="form-note">You can add an anchor image after creating your project.</p>
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          Create project
        </button>
      </div>
    </form>
  );
}
