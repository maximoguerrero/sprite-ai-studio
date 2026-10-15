import { useState, type FormEvent } from "react";

export type ThemeColors = {
  background: string;
  panel: string;
  raised: string;
  accent: string;
  text: string;
  muted: string;
  border: string;
};

export type CustomTheme = {
  id: string;
  name: string;
  colors: ThemeColors;
};

const starterColors: ThemeColors = {
  background: "#10100f",
  panel: "#171715",
  raised: "#1d1d1a",
  accent: "#c9f36a",
  text: "#e9e8e2",
  muted: "#8b8b80",
  border: "#292925",
};

const colorFields: Array<{ key: keyof ThemeColors; label: string; hint: string }> = [
  { key: "background", label: "Background", hint: "App canvas" },
  { key: "panel", label: "Panel", hint: "Cards and surfaces" },
  { key: "raised", label: "Raised surface", hint: "Inputs and controls" },
  { key: "accent", label: "Accent", hint: "Links, checks, and selection" },
  { key: "text", label: "Text", hint: "Primary text" },
  { key: "muted", label: "Muted text", hint: "Secondary text" },
  { key: "border", label: "Borders", hint: "Dividers and outlines" },
];

type ThemeSettingsProps = {
  theme: string;
  customThemes: CustomTheme[];
  onChange: (theme: string) => void;
  onSaveCustomTheme: (theme: CustomTheme) => void;
  onDeleteCustomTheme: (id: string) => void;
};

function validHex(value: string) {
  return /^#[\da-f]{6}$/i.test(value);
}

export function ThemeSettings({
  theme,
  customThemes,
  onChange,
  onSaveCustomTheme,
  onDeleteCustomTheme,
}: ThemeSettingsProps) {
  const selectedCustom = customThemes.find((item) => theme === `custom:${item.id}`);
  const [name, setName] = useState(selectedCustom?.name ?? "My theme");
  const [colors, setColors] = useState<ThemeColors>(selectedCustom?.colors ?? starterColors);
  const [message, setMessage] = useState("");

  function editTheme(id: string) {
    const selected = customThemes.find((item) => item.id === id);
    if (!selected) return;
    setName(selected.name);
    setColors(selected.colors);
    onChange(`custom:${selected.id}`);
    setMessage("");
  }

  function saveTheme(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setMessage("Give your theme a name before saving.");
      return;
    }
    if (!Object.values(colors).every(validHex)) {
      setMessage("Choose a valid color for each theme setting.");
      return;
    }
    const saved: CustomTheme = { id: selectedCustom?.id ?? crypto.randomUUID(), name: normalizedName, colors };
    onSaveCustomTheme(saved);
    onChange(`custom:${saved.id}`);
    setMessage(`“${saved.name}” is ready to use.`);
  }

  function startNewTheme() {
    setName("My theme");
    setColors(starterColors);
    onChange("studio");
    setMessage("");
  }

  return (
    <section className="theme-settings-panel custom-theme-settings">
      <div className="theme-settings-copy">
        <div className="eyebrow">APPEARANCE</div>
        <h2>Make it your own</h2>
        <p>Choose a preset, or build and save a palette for your workspace. Custom themes stay on this device.</p>
        <div className="theme-options">
          <button
            type="button"
            className={`theme-option ${theme === "studio" ? "selected" : ""}`}
            aria-pressed={theme === "studio"}
            onClick={() => onChange("studio")}
          >
            <span className="theme-swatch studio-swatch">
              <i />
              <i />
              <i />
            </span>
            <strong>Studio</strong>
            <small>Charcoal · Lime</small>
          </button>
          <button
            type="button"
            className={`theme-option ${theme === "academic" ? "selected" : ""}`}
            aria-pressed={theme === "academic"}
            onClick={() => onChange("academic")}
          >
            <span className="theme-swatch academic-swatch">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <strong>Academic blue</strong>
            <small>Yale · Oxford · Mint</small>
          </button>
          {customThemes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`theme-option custom-theme-option ${theme === `custom:${item.id}` ? "selected" : ""}`}
              aria-pressed={theme === `custom:${item.id}`}
              onClick={() => editTheme(item.id)}
            >
              <span className="theme-swatch custom-swatch">
                {[item.colors.background, item.colors.panel, item.colors.accent].map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
              <strong>{item.name}</strong>
              <small>Custom palette</small>
            </button>
          ))}
        </div>
      </div>
      <form className="custom-theme-form" onSubmit={saveTheme}>
        <div className="custom-theme-form-heading">
          <div>
            <h3>{selectedCustom ? "Edit custom theme" : "Create a custom theme"}</h3>
            <p>Set the colors that define your workspace.</p>
          </div>
          <button type="button" className="text-button" onClick={startNewTheme}>
            ＋ New theme
          </button>
        </div>
        <label className="custom-theme-name">
          Theme name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={32}
            placeholder="e.g. Sunset arcade"
          />
        </label>
        <div className="theme-color-grid">
          {colorFields.map(({ key, label, hint }) => (
            <label className="theme-color-field" key={key}>
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <input
                type="color"
                aria-label={label}
                value={validHex(colors[key]) ? colors[key] : starterColors[key]}
                onChange={(event) => setColors((current) => ({ ...current, [key]: event.target.value }))}
              />
              <code>{colors[key]}</code>
            </label>
          ))}
        </div>
        <div className="custom-theme-form-footer">
          <span role="status">{message}</span>
          <div>
            {selectedCustom && (
              <button
                type="button"
                className="button secondary destructive-button"
                onClick={() => {
                  onDeleteCustomTheme(selectedCustom.id);
                  onChange("studio");
                  setName("My theme");
                  setColors(starterColors);
                  setMessage("Custom theme deleted.");
                }}
              >
                Delete theme
              </button>
            )}
            <button className="button primary" type="submit">
              {selectedCustom ? "Save theme" : "Create theme"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
