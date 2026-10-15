import { useRef, useState, type FormEvent } from "react";
import type { SavedSkill, StudioProject } from "../types";

type RewrittenSkill = { description: string; promptTemplate: string; negativePrompt: string; workflowNotes?: string[] };

export function SkillForm({
  skill,
  activeProject,
  onSubmit,
  onCancel,
  onRewrite,
}: {
  skill: SavedSkill | null;
  activeProject: StudioProject | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onRewrite: (current: {
    name: string;
    description?: string;
    promptTemplate: string;
    negativePrompt?: string;
  }) => Promise<RewrittenSkill>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteMessage, setRewriteMessage] = useState("");

  async function rewrite() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setRewriting(true);
    setRewriteMessage("");
    try {
      const result = await onRewrite({
        name: String(data.get("name") || ""),
        description: String(data.get("description") || "") || undefined,
        promptTemplate: String(data.get("prompt") || ""),
        negativePrompt: String(data.get("negativePrompt") || "") || undefined,
      });
      const setField = (name: string, value: string) => {
        const element = form.elements.namedItem(name);
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) element.value = value;
      };
      setField("description", result.description);
      setField("prompt", result.promptTemplate);
      setField("negativePrompt", result.negativePrompt);
      if (result.workflowNotes) setField("notes", result.workflowNotes.join("\n"));
      setRewriteMessage("Skill rewritten — review the fields, then save.");
    } catch (error) {
      setRewriteMessage(error instanceof Error ? error.message : "The rewrite failed.");
    } finally {
      setRewriting(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <label>
        Skill name
        <input name="name" defaultValue={skill?.name} placeholder="e.g. Cozy pixel-art props" required autoFocus />
      </label>
      <label>
        Description
        <input name="description" defaultValue={skill?.description} placeholder="When should this recipe be used?" />
      </label>
      <label>
        Category
        <select name="category" defaultValue={skill?.category ?? "general"}>
          <option value="general">General</option>
          <option value="character">Character</option>
          <option value="animation">Animation</option>
          <option value="asset">Asset</option>
        </select>
      </label>
      <label>
        Save to
        <select name="projectId" defaultValue={skill?.projectId ?? ""}>
          <option value="">Global skills library</option>
          {activeProject && <option value={activeProject.id}>{activeProject.name} (project only)</option>}
        </select>
      </label>
      <div className="skill-rewrite-row">
        <label>
          Prompt template
          <textarea
            name="prompt"
            defaultValue={skill?.promptTemplate}
            placeholder="Use placeholders like {subject}, {style}, or {motion}…"
            rows={4}
            required
          />
        </label>
        <div className="skill-rewrite-actions">
          <button type="button" className="button secondary" disabled={rewriting} onClick={() => void rewrite()}>
            {rewriting ? "Rewriting…" : "Rewrite with text model"}
          </button>
          {rewriteMessage && (
            <small className="skill-rewrite-message" role="status">
              {rewriteMessage}
            </small>
          )}
        </div>
      </div>
      <label>
        Negative prompt
        <textarea
          name="negativePrompt"
          defaultValue={skill?.negativePrompt}
          placeholder="Things to avoid in generated results"
          rows={2}
        />
      </label>
      <div className="skill-default-grid">
        <label>
          Size preset
          <select name="size" defaultValue={skill?.defaults.size ?? ""}>
            <option value="">Use project size</option>
            <option value="64">64 × 64</option>
            <option value="128">128 × 128</option>
            <option value="512">512 × 512</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Frame count
          <input
            name="frameCount"
            type="number"
            min="1"
            max="64"
            defaultValue={skill?.defaults.frameCount}
            placeholder="—"
          />
        </label>
        <label>
          FPS
          <input name="fps" type="number" min="1" max="60" defaultValue={skill?.defaults.fps} placeholder="—" />
        </label>
      </div>
      <div className="skill-checkboxes">
        <label>
          <input type="checkbox" name="pixelArt" defaultChecked={skill?.defaults.pixelArt ?? false} /> Pixel art
        </label>
        <label>
          <input
            type="checkbox"
            name="transparentBackground"
            defaultChecked={skill?.defaults.transparentBackground ?? false}
          />{" "}
          Transparent background
        </label>
        <label>
          <input type="checkbox" name="loop" defaultChecked={skill?.defaults.loop ?? false} /> Loop animation
        </label>
      </div>
      <label>
        Workflow notes <small>(one per line)</small>
        <textarea
          name="notes"
          defaultValue={skill?.workflowNotes?.join("\n")}
          placeholder="Inspect first frame before animating\nKeep silhouette stable"
          rows={2}
        />
      </label>
      <p className="form-note">Skills are structured prompt recipes. They do not run code.</p>
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          {skill ? "Save changes" : "Save skill"}
        </button>
      </div>
    </form>
  );
}
