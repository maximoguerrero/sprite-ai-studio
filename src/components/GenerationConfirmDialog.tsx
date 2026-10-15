import { useState } from "react";
import type { ImageModelGroup, ImageModelRequirement } from "../hooks/useImageModelCatalog";
import { imageModelChoiceIds } from "../hooks/useImageModelCatalog";
import { Dialog } from "./Dialog";
import { ImageModelPicker } from "./ImageModelPicker";

// Confirm step shown before every image generation: explains the action, lets the user pick the
// provider/model for this job only, then confirms. Replaces the previous window.confirm dialogs.
export function GenerationConfirmDialog({
  title,
  message,
  groups,
  requirement,
  defaultValue,
  actionLabel = "Generate",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  groups: ImageModelGroup[];
  requirement: ImageModelRequirement;
  defaultValue: string;
  actionLabel?: string;
  onConfirm: (choiceId: string) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState(defaultValue);
  const choices = imageModelChoiceIds(groups, requirement);
  const canConfirm = choices.includes(choice);
  return (
    <Dialog title={title} onClose={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm) onConfirm(choice);
        }}
      >
        <p className="generation-confirm-message">{message}</p>
        <label className="generation-confirm-model">
          Model
          <span>Pick the provider model for this generation. It applies to this action only.</span>
          <ImageModelPicker
            groups={groups}
            value={choice}
            onChange={setChoice}
            requirement={requirement}
            ariaLabel="Model used for this generation"
          />
        </label>
        {!choices.length ? (
          <p className="storage-note">
            No configured provider fits this generation. Enable image edits, or add a provider that supports it, in
            provider settings.
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={!canConfirm}>
            {actionLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
