export function ArtModePicker({
  value,
  onChange,
}: {
  value: "pixel" | "hd";
  onChange: (value: "pixel" | "hd") => void;
}) {
  return (
    <fieldset className="direction-picker art-mode-picker">
      <legend>Art mode</legend>
      <div className="art-mode-options">
        <button
          type="button"
          className={value === "pixel" ? "art-mode-option selected" : "art-mode-option"}
          aria-pressed={value === "pixel"}
          onClick={() => onChange("pixel")}
        >
          <span className="art-mode-icon pixel-mode-icon" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <strong>Pixel art</strong>
          <small>Hard-edged pixels</small>
        </button>
        <button
          type="button"
          className={value === "hd" ? "art-mode-option selected" : "art-mode-option"}
          aria-pressed={value === "hd"}
          onClick={() => onChange("hd")}
        >
          <span className="art-mode-icon smooth-mode-icon" aria-hidden="true">
            <i />
          </span>
          <strong>Smooth / HD</strong>
          <small>Soft detail</small>
        </button>
      </div>
    </fieldset>
  );
}
