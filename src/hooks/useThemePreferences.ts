import { useEffect, useState } from "react";
import type { CustomTheme } from "../components/ThemeSettings";

const THEME_KEY = "sprite-studio.theme.v1";
const CUSTOM_THEMES_KEY = "sprite-studio.customThemes.v1";

export function useThemePreferences() {
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) ?? "[]");
      return Array.isArray(saved)
        ? saved.filter((entry): entry is CustomTheme => {
            if (!entry || typeof entry !== "object") return false;
            const candidate = entry as Partial<CustomTheme>;
            return (
              typeof candidate.id === "string" &&
              typeof candidate.name === "string" &&
              Boolean(
                candidate.colors &&
                ["background", "panel", "raised", "accent", "text", "muted", "border"].every(
                  (key) =>
                    typeof candidate.colors?.[key as keyof CustomTheme["colors"]] === "string" &&
                    /^#[\da-f]{6}$/i.test(candidate.colors[key as keyof CustomTheme["colors"]])
                )
              )
            );
          })
        : [];
    } catch {
      return [];
    }
  });
  const [theme, setTheme] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY) ?? "studio";
      return saved.startsWith("custom:") || saved === "academic" ? saved : "studio";
    } catch {
      return "studio";
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    const isCustom = theme.startsWith("custom:");
    root.dataset.theme = isCustom ? "custom" : theme;
    const selectedCustomTheme = isCustom ? customThemes.find((item) => `custom:${item.id}` === theme) : undefined;
    if (selectedCustomTheme) {
      root.style.setProperty("--bg", selectedCustomTheme.colors.background);
      root.style.setProperty("--panel", selectedCustomTheme.colors.panel);
      root.style.setProperty("--panel-2", selectedCustomTheme.colors.raised);
      root.style.setProperty("--lime", selectedCustomTheme.colors.accent);
      root.style.setProperty("--lime-dim", selectedCustomTheme.colors.accent);
      root.style.setProperty("--text", selectedCustomTheme.colors.text);
      root.style.setProperty("--line", selectedCustomTheme.colors.border);
      root.style.setProperty("--soft", selectedCustomTheme.colors.text);
      root.style.setProperty("--muted", selectedCustomTheme.colors.muted);
    } else {
      for (const property of [
        "--bg",
        "--panel",
        "--panel-2",
        "--lime",
        "--lime-dim",
        "--text",
        "--line",
        "--soft",
        "--muted",
      ])
        root.style.removeProperty(property);
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Session theme still applies if storage is unavailable. */
    }
  }, [theme, customThemes]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
    } catch {
      /* Custom themes remain available for this session if storage is unavailable. */
    }
  }, [customThemes]);

  return { customThemes, setCustomThemes, theme, setTheme };
}
