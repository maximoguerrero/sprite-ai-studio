import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { AnimationPhase, SavedSkill, StudioProject } from "../types";
import { animationPresets } from "../data/animationPresets";
import { makeId } from "../lib/ids";
import { skillPlaceholders } from "../lib/skills";
import { CanvasSizeFields } from "./CanvasSizeFields";

export function CreateCardDialog({
  kind,
  activeProject,
  availableSkills,
  draftAnimationPreset,
  setDraftAnimationPreset,
  draftPrompt,
  setDraftPrompt,
  draftLoop,
  setDraftLoop,
  draftPhases,
  setDraftPhases,
  draftSkillId,
  setDraftSkillId,
  skillVariables,
  setSkillVariables,
  onSubmit,
  onClose,
}: {
  kind: "animation" | "asset";
  activeProject: StudioProject | null;
  availableSkills: SavedSkill[];
  draftAnimationPreset: string;
  setDraftAnimationPreset: Dispatch<SetStateAction<string>>;
  draftPrompt: string;
  setDraftPrompt: Dispatch<SetStateAction<string>>;
  draftLoop: boolean;
  setDraftLoop: Dispatch<SetStateAction<boolean>>;
  draftPhases: AnimationPhase[];
  setDraftPhases: Dispatch<SetStateAction<AnimationPhase[]>>;
  draftSkillId: string;
  setDraftSkillId: Dispatch<SetStateAction<string>>;
  skillVariables: Record<string, string>;
  setSkillVariables: Dispatch<SetStateAction<Record<string, string>>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label className={kind === "animation" ? "animation-name-field" : ""}>
        {kind === "animation" ? "Animation name" : "Asset name"}
        <input
          name="name"
          placeholder={kind === "animation" ? "e.g. Walk cycle" : "e.g. Iron sword"}
          required
          autoFocus
        />
      </label>
      {kind === "animation" && (
        <>
          <section className="animation-setup-section">
            <div className="animation-setup-heading">
              <span className="eyebrow">01 · START WITH A MOTION</span>
              <small>Pick a starting structure, then customize the key poses.</small>
            </div>
            <label className="animation-preset-field">
              Action preset
              <select
                name="actionPreset"
                value={draftAnimationPreset}
                onChange={(event) => {
                  const preset = animationPresets.find((item) => item.id === event.target.value) ?? animationPresets[0];
                  setDraftAnimationPreset(preset.id);
                  setDraftPrompt(preset.prompt);
                  setDraftLoop(preset.loop);
                  setDraftPhases(preset.phases.map((label) => ({ id: makeId(), label, prompt: `${label} pose` })));
                }}
              >
                {animationPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="animation-setup-section phase-planner">
            <div className="phase-planner-heading">
              <div>
                <span className="eyebrow">02 · KEY POSES</span>
                <small>
                  Frames are generated in this order. Give each pose a short name and clear visual direction.
                </small>
              </div>
              <button
                type="button"
                className="button secondary add-phase-button"
                onClick={() =>
                  setDraftPhases((phases) => [
                    ...phases,
                    { id: makeId(), label: `Phase ${phases.length + 1}`, prompt: "Describe the key pose and action" },
                  ])
                }
              >
                ＋ Add pose
              </button>
            </div>
            {draftPhases.length ? (
              <div className="phase-row-list">
                {draftPhases.map((phase, index) => (
                  <article className="phase-row" key={phase.id}>
                    <div className="phase-row-top">
                      <span className="phase-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="phase-row-caption">FRAME {String(index + 1).padStart(2, "0")}</span>
                      <button
                        type="button"
                        className="remove-phase-button"
                        aria-label={`Remove phase ${index + 1}`}
                        title="Remove pose"
                        disabled={draftPhases.length <= 1}
                        onClick={() => setDraftPhases((phases) => phases.filter((item) => item.id !== phase.id))}
                      >
                        ×
                      </button>
                    </div>
                    <label className="phase-label-field">
                      Pose name
                      <input
                        aria-label={`Phase ${index + 1} label`}
                        value={phase.label}
                        placeholder="e.g. Right foot contact"
                        onChange={(event) =>
                          setDraftPhases((phases) =>
                            phases.map((item) => (item.id === phase.id ? { ...item, label: event.target.value } : item))
                          )
                        }
                      />
                    </label>
                    <label className="phase-prompt-field">
                      What should the sprite look like?
                      <textarea
                        aria-label={`Phase ${index + 1} prompt`}
                        value={phase.prompt}
                        placeholder="Describe body position, limb placement, and silhouette…"
                        rows={2}
                        onChange={(event) =>
                          setDraftPhases((phases) =>
                            phases.map((item) =>
                              item.id === phase.id ? { ...item, prompt: event.target.value } : item
                            )
                          )
                        }
                      />
                    </label>
                  </article>
                ))}
              </div>
            ) : (
              <div className="phase-empty-state">
                <strong>No poses yet</strong>
                <span>Add poses to define the animation frames.</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setDraftPhases([{ id: makeId(), label: "Starting pose", prompt: "Describe the starting pose" }])
                  }
                >
                  ＋ Add first pose
                </button>
              </div>
            )}
          </section>
          <section className="animation-setup-section">
            <div className="animation-setup-heading">
              <span className="eyebrow">03 · PLAYBACK</span>
              <small>Set timing and loop behavior for your animation.</small>
            </div>
            <div className="animation-settings-fields">
              <label>
                Frames per sheet
                <input type="number" value={8} readOnly aria-readonly="true" />
              </label>
              <label>
                Playback FPS
                <input name="fps" type="number" min="1" max="60" defaultValue="8" />
              </label>
              <label className="animation-loop-option">
                <input
                  type="checkbox"
                  name="loop"
                  checked={draftLoop}
                  onChange={(event) => setDraftLoop(event.target.checked)}
                />{" "}
                Loop animation
              </label>
            </div>
          </section>
          {draftSkillId && availableSkills.find((skill) => skill.id === draftSkillId)?.defaults.frameCount && (
            <p className="skill-setting-hint">
              Selected skill default: {availableSkills.find((skill) => skill.id === draftSkillId)?.defaults.frameCount}{" "}
              frames, {availableSkills.find((skill) => skill.id === draftSkillId)?.defaults.fps ?? 8} FPS.
            </p>
          )}
          <p className="form-note">
            Generation uses only the selected project anchor as an image reference and returns one 8-frame sheet.
          </p>
        </>
      )}
      {kind === "asset" && (
        <div className="asset-card-settings">
          <label>
            Art mode
            <select name="artMode" defaultValue="pixel">
              <option value="pixel">Pixel art</option>
              <option value="hd">Smooth / HD</option>
            </select>
          </label>
          <label>
            Variations
            <select name="variations" defaultValue="1">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="asset-transparency">
            <input type="checkbox" name="transparentBackground" defaultChecked /> Transparent background
          </label>
          <label className="pose-upload-field">
            Reference image (optional)
            <input type="file" name="referenceImage" accept="image/png,image/jpeg,image/webp" />
            <small>Use this image as a reference for generated variations.</small>
          </label>
        </div>
      )}
      <CanvasSizeFields
        name="cardSize"
        label="Canvas size"
        defaultValue="inherit"
        inheritedLabel={`Inherit project (${activeProject?.size === "custom" ? `${activeProject.canvasSize?.width ?? 64} × ${activeProject.canvasSize?.height ?? 64}` : `${activeProject?.size ?? 64} × ${activeProject?.size ?? 64}`})`}
      />
      <label>
        Apply a skill
        <select
          name="skillId"
          value={draftSkillId}
          onChange={(event) => {
            const skill = availableSkills.find((item) => item.id === event.target.value);
            setDraftSkillId(event.target.value);
            setDraftPrompt(skill?.promptTemplate ?? "");
            setSkillVariables({});
          }}
        >
          <option value="">No skill</option>
          {availableSkills
            .filter(
              (skill) => skill.category === "general" || skill.category === kind || skill.category === "character"
            )
            .map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
                {skill.projectId ? " · project" : " · global"}
              </option>
            ))}
        </select>
      </label>
      {draftSkillId && skillPlaceholders(draftPrompt).length > 0 && (
        <div className="skill-variable-fields">
          {skillPlaceholders(draftPrompt).map((placeholder) => (
            <label key={placeholder}>
              {placeholder.replaceAll("_", " ")}
              <input
                value={skillVariables[placeholder] ?? ""}
                onChange={(event) =>
                  setSkillVariables((current) => ({ ...current, [placeholder]: event.target.value }))
                }
                placeholder={`Value for ${placeholder}`}
              />
            </label>
          ))}
        </div>
      )}
      <label>
        Prompt
        <textarea
          name="prompt"
          value={draftPrompt}
          onChange={(event) => setDraftPrompt(event.target.value)}
          placeholder={
            kind === "animation"
              ? "Describe the motion, what stays consistent, and whether it loops…"
              : "Describe the asset, style, palette, and background…"
          }
          rows={4}
        />
      </label>
      <div className="form-note">
        Animation settings can be changed later in the card editor. Skill placeholders can be filled above or left in
        the prompt.
      </div>
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          Create {kind} card
        </button>
      </div>
    </form>
  );
}
