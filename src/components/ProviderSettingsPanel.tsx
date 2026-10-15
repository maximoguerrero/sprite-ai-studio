import { useEffect, useState, type FormEvent } from "react";
import type { ProviderProfile } from "../types";
import type { ProviderModelInfo } from "../openAIProvider";
import { isProviderSecretRemembered, saveBrowserProviderSecret } from "../providerSecrets";

export function ProviderSettingsPanel({
  profiles,
  activeProfile,
  activeProfileId,
  draftType,
  models,
  modelDetails,
  busy,
  message,
  onChoose,
  onSave,
  onTest,
  onLoadModels,
  onDelete,
  onNew,
  onToggleEnabled,
}: {
  profiles: ProviderProfile[];
  activeProfile: ProviderProfile | null;
  activeProfileId: string | null;
  draftType: NonNullable<ProviderProfile["providerType"]>;
  models: string[];
  modelDetails: ProviderModelInfo[];
  busy: boolean;
  message: string;
  onChoose: (id: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onTest: () => void;
  onLoadModels: () => void;
  onDelete: () => void;
  onNew: (type: NonNullable<ProviderProfile["providerType"]>) => void;
  onToggleEnabled: (id: string) => void;
}) {
  const isConnected = /connected|responded|ready|loaded/i.test(message);
  const [browserKeyForSession, setBrowserKeyForSession] = useState("");
  const [apiKeyForSession, setApiKeyForSession] = useState("");
  const [browserKeyMessage, setBrowserKeyMessage] = useState("");
  const [rememberBrowserKey, setRememberBrowserKey] = useState(() =>
    Boolean(activeProfile && isProviderSecretRemembered(activeProfile.id))
  );
  useEffect(() => {
    setRememberBrowserKey(Boolean(activeProfile && isProviderSecretRemembered(activeProfile.id)));
    setBrowserKeyForSession("");
    setBrowserKeyMessage("");
  }, [activeProfile?.id]);
  const statusLabel = busy
    ? "Checking"
    : isConnected
      ? "Connected"
      : activeProfile?.apiKeyConfigured
        ? "Ready to test"
        : "Needs setup";
  const providerType = activeProfile?.providerType ?? draftType;
  const profileNameDefault =
    activeProfile?.name ??
    (draftType === "parley" ? "Parley" : draftType === "grok" ? "Grok Imagine" : "OpenAI-compatible");
  const baseUrlDefault =
    activeProfile?.baseUrl ??
    (draftType === "parley"
      ? "https://parley.api.mit.edu"
      : draftType === "grok"
        ? "https://api.x.ai"
        : "https://api.openai.com");
  const modelDefault =
    activeProfile?.model ??
    (draftType === "parley" ? "openai/gpt-image-2" : draftType === "grok" ? "grok-imagine-image-2.0" : "gpt-image-1");
  const isGrok =
    providerType === "grok" || (activeProfile ? /api\.x\.ai/i.test(activeProfile.baseUrl) : draftType === "grok");
  return (
    <section className="provider-settings">
      <div className="provider-settings-heading">
        <div>
          <div className="eyebrow">IMAGE GENERATION</div>
          <h2>Provider</h2>
          <p>Connect an OpenAI-compatible image API. Credentials are kept separate from project data.</p>
        </div>
        <div className="provider-add-actions">
          <button className="button secondary" type="button" onClick={() => onNew("openai-compatible")}>
            ＋ OpenAI-compatible
          </button>
          <button className="button secondary parley-add" type="button" onClick={() => onNew("parley")}>
            ＋ Parley
          </button>
          <button className="button secondary grok-add" type="button" onClick={() => onNew("grok")}>
            ＋ Grok Image
          </button>
        </div>
      </div>
      <div className="provider-status-bar">
        <span className={`provider-status-dot ${busy ? "checking" : isConnected ? "connected" : ""}`} />
        <span>
          <strong>{activeProfile?.name ?? "No provider selected"}</strong>
          <small>
            {activeProfile
              ? `${activeProfile.baseUrl} · ${activeProfile.model}`
              : "Add a profile to enable image generation"}
          </small>
        </span>
        <span className={`provider-status-label ${isConnected ? "connected" : ""}`}>{statusLabel}</span>
      </div>
      {profiles.length > 0 && (
        <div className="provider-profile-tabs" role="tablist" aria-label="Provider profiles">
          {profiles.map((profile) => (
            <button
              type="button"
              role="tab"
              aria-selected={profile.id === activeProfileId}
              key={profile.id}
              className={`${profile.id === activeProfileId ? "provider-profile-tab active" : "provider-profile-tab"}${profile.enabled === false ? " disabled-provider" : ""}`}
              onClick={() => onChoose(profile.id)}
            >
              <span className="profile-tab-name">{profile.name}</span>
              <span className="profile-tab-model">{profile.model}</span>
              <span className="profile-tab-meta">
                <span
                  className={`profile-tab-kind ${profile.modelKind === "text" ? "text" : profile.modelKind === "video" ? "video" : "image"}`}
                >
                  {profile.modelKind === "text" ? "text" : profile.modelKind === "video" ? "video" : "image"}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className={`profile-tab-enabled ${profile.enabled === false ? "off" : "on"}`}
                  aria-pressed={profile.enabled !== false}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleEnabled(profile.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleEnabled(profile.id);
                    }
                  }}
                >
                  {profile.enabled === false ? "Disabled" : "Enabled"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <form key={activeProfile?.id ?? `new-provider-${draftType}`} className="provider-form" onSubmit={onSave}>
        <input type="hidden" name="id" value={activeProfile?.id ?? ""} />
        <input type="hidden" name="providerType" value={providerType} />
        <div className="provider-form-heading">
          <h3>
            {activeProfile
              ? "Connection details"
              : `Add ${draftType === "parley" ? "Parley" : draftType === "grok" ? "Grok Image" : "OpenAI-compatible"}`}
          </h3>
          <p>
            {providerType === "parley"
              ? "Parley uses the OpenAI image generation route with provider-specific model IDs and quality options."
              : providerType === "grok"
                ? "xAI Grok Imagine uses the OpenAI-compatible image generations route and returns image URLs."
                : "Use your provider’s OpenAI-compatible API base URL and image model name."}
          </p>
        </div>
        <div className="provider-fields">
          <label className="provider-field">
            Profile name<span>Label used inside this app.</span>
            <input name="name" defaultValue={profileNameDefault} placeholder="My image endpoint" required />
          </label>
          <label className="provider-field">
            Base URL
            <span>
              {providerType === "parley"
                ? "Parley API base URL."
                : providerType === "grok"
                  ? "xAI API base URL."
                  : "Include host or API prefix; `/v1` is optional."}
            </span>
            <input
              name="baseUrl"
              type="url"
              defaultValue={baseUrlDefault}
              placeholder="https://api.openai.com"
              required
            />
          </label>
          <label className="provider-field">
            Model ID
            <span>
              {providerType === "parley"
                ? "Use provider/model format, e.g. openai/gpt-image-2."
                : providerType === "grok"
                  ? "Grok Imagine image model, e.g. grok-imagine-image-2.0."
                  : "Default model for this endpoint; text models rewrite skill prompts."}
            </span>
            <input
              name="model"
              list="provider-model-options"
              defaultValue={modelDefault}
              placeholder="e.g. gpt-image-1"
              required
            />
            <datalist id="provider-model-options">
              {modelDetails.length
                ? modelDetails.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.kind === "image"
                        ? "image generator"
                        : model.kind === "video"
                          ? "video generator"
                          : "text generator"}
                    </option>
                  ))
                : models.map((model) => <option key={model} value={model} />)}
            </datalist>
          </label>
          <label className="provider-field">
            Image model ID
            <span>
              Used for sprite and asset generation. Detected automatically when you test the connection; leave empty to
              use the model above.
            </span>
            <input
              name="imageModel"
              list="provider-image-model-options"
              defaultValue={activeProfile?.imageModel ?? ""}
              placeholder="e.g. flux-schnell"
            />
            <datalist id="provider-image-model-options">
              {modelDetails
                .filter((model) => model.kind === "image")
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    image generator
                  </option>
                ))}
            </datalist>
          </label>
          <label className="provider-field">
            Model type
            <span>
              Image models generate sprites; text models can rewrite skill prompts; video models generate sprite
              animation clips.
            </span>
            <select name="modelKind" defaultValue={activeProfile?.modelKind ?? "image"}>
              <option value="image">Image generation</option>
              <option value="text">Text generation</option>
              {isGrok && <option value="video">Video generation</option>}
            </select>
          </label>
          {isGrok && (
            <label className="provider-field">
              Video model ID<span>Used for sprite video animation generation, e.g. grok-imagine-video-1.5-lite.</span>
              <input
                name="videoModel"
                list="provider-video-model-options"
                defaultValue={activeProfile?.videoModel ?? ""}
                placeholder="e.g. grok-imagine-video-1.5-lite"
              />
              <datalist id="provider-video-model-options">
                {modelDetails
                  .filter((model) => model.kind === "video")
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      video generator
                    </option>
                  ))}
              </datalist>
            </label>
          )}
          {providerType !== "grok" && (
            <label className="provider-field">
              Image quality
              <span>
                {providerType === "parley"
                  ? "Parley supports auto, low, medium, or high."
                  : "Used when the endpoint accepts a quality option."}
              </span>
              <select name="quality" defaultValue={activeProfile?.quality ?? "auto"}>
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          )}
          <label className="provider-field">
            API key
            <span>
              {activeProfile?.apiKeyConfigured
                ? "A key is configured for desktop or another session."
                : "Required to generate with this provider."}
            </span>
            <input
              name="apiKey"
              type="password"
              autoComplete="new-password"
              placeholder={activeProfile?.apiKeyConfigured ? "Enter a replacement key" : "Paste API key"}
              required={!activeProfile?.apiKeyConfigured}
            />
          </label>
          {!window.__TAURI_INTERNALS__ && activeProfile?.apiKeyConfigured && (
            <div className="provider-field browser-session-key">
              <label>
                Browser session key
                <span>
                  {isProviderSecretRemembered(activeProfile.id)
                    ? "Key is remembered in this browser on this device."
                    : "Enter the key for this session. Remembering it is optional."}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKeyForSession}
                  onChange={(event) => setApiKeyForSession(event.target.value)}
                  placeholder={
                    isProviderSecretRemembered(activeProfile.id)
                      ? "Key remembered — enter to replace"
                      : "Enter key for browser session"
                  }
                />
              </label>
              <div className="browser-key-actions">
                <label className="remember-key-option">
                  <input
                    type="checkbox"
                    checked={rememberBrowserKey}
                    onChange={(event) => setRememberBrowserKey(event.target.checked)}
                  />
                  <span>Remember on this device</span>
                </label>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!apiKeyForSession.trim()}
                  onClick={async () => {
                    try {
                      await saveBrowserProviderSecret(activeProfile.id, apiKeyForSession.trim(), rememberBrowserKey);
                      setApiKeyForSession("");
                      setBrowserKeyForSession(activeProfile.id);
                      setBrowserKeyMessage(
                        rememberBrowserKey
                          ? "API key remembered on this device and ready for this session."
                          : "API key is ready for this session only."
                      );
                    } catch (error) {
                      setBrowserKeyMessage(
                        error instanceof Error ? error.message : "Could not save the browser API key."
                      );
                    }
                  }}
                >
                  Use key
                </button>
              </div>
              <small className="browser-key-storage-note">
                Remembered keys are stored in this browser’s local storage on this device.
              </small>
              {browserKeyForSession === activeProfile.id && (
                <small className="session-key-ready">✓ Key ready for this session</small>
              )}
              {browserKeyMessage && (
                <small className="session-key-message" role="status">
                  {browserKeyMessage}
                </small>
              )}
            </div>
          )}
          {(providerType === "openai-compatible" || providerType === "grok") && (
            <div className="provider-feature-flags">
              <strong>Capabilities this endpoint supports</strong>
              <label>
                <input
                  type="checkbox"
                  name="imageToImage"
                  defaultChecked={providerType === "grok" || activeProfile?.capabilities?.imageToImage === true}
                  disabled={providerType === "grok"}
                />{" "}
                Image edits/references{providerType === "grok" ? " (supported)" : ""}
              </label>
              {providerType === "grok" && <input type="hidden" name="imageToImage" value="on" />}
              <label>
                <input
                  type="checkbox"
                  name="transparency"
                  defaultChecked={activeProfile?.capabilities?.transparency ?? false}
                />{" "}
                Transparent-background parameter
              </label>
              <small>
                {providerType === "grok"
                  ? "xAI Grok Imagine documents image edits; transparency is endpoint-dependent."
                  : "Only enable options supported by this endpoint."}
              </small>
            </div>
          )}
        </div>
        <div className="provider-form-footer">
          <div className="provider-form-actions">
            <button type="submit" className="button primary">
              Save provider
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!activeProfile?.apiKeyConfigured || busy}
              onClick={onTest}
            >
              {busy ? "Checking…" : providerType === "parley" ? "Verify API key" : "Test connection"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!activeProfile?.apiKeyConfigured || busy || providerType === "parley"}
              onClick={onLoadModels}
            >
              {busy ? "Loading…" : "Load models"}
            </button>
          </div>
          {activeProfile && (
            <button type="button" className="text-button destructive" onClick={onDelete}>
              Remove provider
            </button>
          )}
        </div>
        {message && (
          <p className={`provider-message ${isConnected ? "success" : ""}`} role="status">
            {isConnected && <span>✓</span>}
            {message}
            {models.length > 0 && <small>{models.length} model IDs available as suggestions above.</small>}
          </p>
        )}
        <div className="provider-capabilities">
          {providerType === "parley" ? (
            <>
              <span>
                <b>Generate</b>
                <code>POST /v1/images/generations</code>
              </span>
              <span>
                <b>Authentication</b>Bearer API key
              </span>
              <span>
                Connection check validates the saved key locally; Parley’s supplied API docs do not list a models
                endpoint.
              </span>
            </>
          ) : providerType === "grok" ? (
            <>
              <span>
                <b>Generate</b>
                <code>POST /v1/images/generations</code>
              </span>
              <span>
                <b>Authentication</b>Bearer xAI API key
              </span>
              <span>Grok Imagine image generation supports URL responses; xAI’s API docs show this route.</span>
            </>
          ) : (
            <>
              <span>
                <b>Test</b>
                <code>GET /v1/models</code>
              </span>
              <span>
                <b>Generate</b>
                <code>POST /v1/images/generations</code>
              </span>
            </>
          )}
        </div>
      </form>
    </section>
  );
}
