import type { StudioProject } from "../types";

const viewDirections: Array<{ id: NonNullable<StudioProject["anchorDirection"]>; label: string; icon: string }> = [
  { id: "front", label: "Front", icon: "◉" },
  { id: "side-left", label: "Left side", icon: "◖" },
  { id: "side-right", label: "Right side", icon: "◗" },
  { id: "top-down", label: "Top-down", icon: "⊙" },
  { id: "isometric", label: "Isometric", icon: "◇" },
];

export function ViewDirectionPicker({
  value,
  onChange,
}: {
  value: NonNullable<StudioProject["anchorDirection"]>;
  onChange: (value: NonNullable<StudioProject["anchorDirection"]>) => void;
}) {
  return (
    <fieldset className="direction-picker">
      <legend>View direction</legend>
      <div className="direction-options">
        {viewDirections.map((direction) => (
          <button
            type="button"
            key={direction.id}
            className={value === direction.id ? "direction-option selected" : "direction-option"}
            aria-pressed={value === direction.id}
            aria-label={direction.label}
            title={direction.label}
            onClick={() => onChange(direction.id)}
          >
            <span aria-hidden="true">{direction.icon}</span>
            <small>{direction.label}</small>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
