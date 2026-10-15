import type { ImageModelGroup, ImageModelRequirement } from "../hooks/useImageModelCatalog";
import { imageModelChoiceId, usableImageModelGroups } from "../hooks/useImageModelCatalog";

/**
 * Reusable image-model dropdown. Lists every model from the configured providers, grouped by
 * provider profile, filtered by what the generation needs (`requirement`). Shared by the Topbar,
 * the AI touch-up dialog, and the generation confirm dialogs.
 */
export function ImageModelPicker({
  groups,
  value,
  onChange,
  requirement = "image",
  id,
  className,
  title,
  ariaLabel = "Image model used for generation",
}: {
  groups: ImageModelGroup[];
  value: string;
  onChange: (value: string) => void;
  requirement?: ImageModelRequirement;
  id?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
}) {
  const usable = usableImageModelGroups(groups, requirement);
  const isListed = usable.some((group) =>
    group.models.some((model) => imageModelChoiceId(group.profileId, model) === value)
  );
  return (
    <select
      id={id}
      className={className}
      aria-label={ariaLabel}
      title={title}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {value && !isListed ? <option value={value}>{value.split("::")[1] ?? "Image model"}</option> : null}
      {usable.map((group) => (
        <optgroup key={group.profileId} label={group.profileName}>
          {group.models.map((model) => (
            <option key={imageModelChoiceId(group.profileId, model)} value={imageModelChoiceId(group.profileId, model)}>
              {model}
            </option>
          ))}
          {group.loading && !group.models.length ? <option value="">Loading models…</option> : null}
          {group.error ? (
            <option value="" disabled>
              ⚠ could not list models
            </option>
          ) : null}
        </optgroup>
      ))}
      {!usable.length ? <option value="">No matching provider configured</option> : null}
    </select>
  );
}
