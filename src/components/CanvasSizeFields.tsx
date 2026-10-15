export function CanvasSizeFields({
  name,
  label,
  defaultValue,
  inheritedLabel,
}: {
  name: string;
  label: string;
  defaultValue: string;
  inheritedLabel?: string;
}) {
  return (
    <>
      <label>
        {label}
        <select
          name={name}
          defaultValue={defaultValue}
          onChange={(event) => {
            const element = event.currentTarget.parentElement?.nextElementSibling;
            if (element instanceof HTMLElement) element.dataset.active = String(event.target.value === "custom");
          }}
        >
          {inheritedLabel && <option value="inherit">{inheritedLabel}</option>}
          <option value="64">64 × 64{!inheritedLabel ? " — recommended" : ""}</option>
          <option value="128">128 × 128</option>
          <option value="512">512 × 512</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <div className="custom-dimensions" data-active="false" id={`${name}-custom`}>
        <label>
          Custom width
          <input
            name={name === "size" ? "customWidth" : "cardWidth"}
            type="number"
            min="1"
            max="4096"
            defaultValue="64"
          />
        </label>
        <label>
          Custom height
          <input
            name={name === "size" ? "customHeight" : "cardHeight"}
            type="number"
            min="1"
            max="4096"
            defaultValue="64"
          />
        </label>
      </div>
    </>
  );
}
