import { useState, type Dispatch, type SetStateAction } from "react";
import type { AnimationPhase } from "../types";
import { videoLoopPresets } from "../data/videoLoopPresets";
import { makeId } from "../lib/ids";

export type VideoSettingsPatch = {
  videoLoopPreset?: string;
  videoDuration?: number;
  videoSampleCount?: number;
  videoPinLoop?: boolean;
};

export function PhasePlannerForm({
  prompt,
  phases,
  onPromptChange,
  onPhasesChange,
  onSave,
  onRewritePrompt,
  cardName,
  videoSettings,
  onVideoSettingsChange,
}: {
  prompt: string;
  phases: AnimationPhase[];
  onPromptChange: (value: string) => void;
  onPhasesChange: Dispatch<SetStateAction<AnimationPhase[]>>;
  onSave: (prompt: string, phases: AnimationPhase[]) => void;
  onRewritePrompt?: (current: { name: string; prompt: string }) => Promise<string>;
  cardName?: string;
  videoSettings?: { loopPreset: string; duration: number; sampleCount: number; pinLoop: boolean };
  onVideoSettingsChange?: (patch: VideoSettingsPatch) => void;
}) {
  const [rewriting, setRewriting] = useState(false);
  const [rewriteMessage, setRewriteMessage] = useState("");
  async function rewriteMotionPrompt() {
    if (!onRewritePrompt) return;
    setRewriting(true);
    setRewriteMessage("");
    try {
      const next = await onRewritePrompt({ name: cardName ?? "animation", prompt });
      onPromptChange(next);
      onSave(next, phases);
      setRewriteMessage("Motion prompt rewritten — review it, then generate.");
    } catch (error) {
      setRewriteMessage(error instanceof Error ? error.message : "The rewrite failed.");
    } finally {
      setRewriting(false);
    }
  }
  return (
    <div className="phase-editor editor-panel">
      <div className="phase-editor-heading">
        <div>
          <span className="eyebrow">MOTION SEQUENCE</span>
          <small>Each phase becomes one generated frame. Adjust its pose prompt before generating.</small>
        </div>
        <button
          className="text-button"
          onClick={() =>
            onPhasesChange((phases) => [
              ...phases,
              { id: makeId(), label: `Phase ${phases.length + 1}`, prompt: "Describe the key pose and action" },
            ])
          }
        >
          ＋ Add phase
        </button>
      </div>
      <label className="animation-prompt-edit">
        Animation prompt
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onBlur={() => onSave(prompt, phases)}
          rows={10}
        />
      </label>
      {onRewritePrompt && (
        <div className="asset-rewrite-row">
          <button
            type="button"
            className="button secondary"
            disabled={rewriting}
            onClick={() => void rewriteMotionPrompt()}
          >
            {rewriting ? "Rewriting…" : "Rewrite motion prompt"}
          </button>
          {rewriteMessage && (
            <small className="skill-rewrite-message" role="status">
              {rewriteMessage}
            </small>
          )}
        </div>
      )}
      {phases.length ? (
        <div className="phase-editor-list">
          {phases.map((phase, index) => (
            <div className="phase-editor-row" key={phase.id}>
              <span className="phase-number">{String(index + 1).padStart(2, "0")}</span>
              <label className="phase-label-field">
                Phase name
                <input
                  aria-label={`Phase ${index + 1} name`}
                  value={phase.label}
                  onChange={(event) =>
                    onPhasesChange((phases) =>
                      phases.map((item) => (item.id === phase.id ? { ...item, label: event.target.value } : item))
                    )
                  }
                  onBlur={() => onSave(prompt, phases)}
                />
              </label>
              <label className="phase-prompt-field">
                <textarea
                  aria-label={`Phase ${index + 1} prompt`}
                  rows={2}
                  value={phase.prompt}
                  onChange={(event) =>
                    onPhasesChange((phases) =>
                      phases.map((item) => (item.id === phase.id ? { ...item, prompt: event.target.value } : item))
                    )
                  }
                  onBlur={() => onSave(prompt, phases)}
                />
              </label>
              <button
                className="remove-phase-button"
                aria-label={`Remove phase ${index + 1}`}
                onClick={() => {
                  const next = phases.filter((item) => item.id === phase.id);
                  onPhasesChange(next);
                  onSave(prompt, next);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="phase-empty">No phases defined. Add motion beats to generate an animation.</p>
      )}
      {videoSettings && onVideoSettingsChange && (
        <div className="phase-video-settings">
          <div className="setting-divider" />
          <div className="eyebrow">VIDEO GENERATION</div>
          <div className="phase-video-settings-fields">
            <label className="setting-field">
              Loop preset
              <select
                value={videoSettings.loopPreset}
                onChange={(event) => onVideoSettingsChange({ videoLoopPreset: event.target.value })}
              >
                {videoLoopPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field">
              Clip duration
              <select
                value={videoSettings.duration}
                onChange={(event) => onVideoSettingsChange({ videoDuration: Number(event.target.value) })}
              >
                {[2, 3, 4, 5, 6].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds}s
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field">
              Extract samples
              <select
                value={videoSettings.sampleCount}
                onChange={(event) => onVideoSettingsChange({ videoSampleCount: Number(event.target.value) })}
              >
                {[8, 12, 16, 24].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle-row">
              <span>
                <strong>Pin first &amp; last frame</strong>
                <small>Seamless loop; requires the grok-imagine-video-1.5 video model</small>
              </span>
              <input
                type="checkbox"
                checked={videoSettings.pinLoop}
                onChange={(event) => onVideoSettingsChange({ videoPinLoop: event.target.checked })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
