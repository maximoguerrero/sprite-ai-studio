import type { SavedSkill } from "../types";
import { savedSkillSchema } from "../schemas";
import { makeId } from "./ids";

export const starterSkills: SavedSkill[] = [
  {
    schemaVersion: 1,
    id: "skill-walk",
    name: "Looping walk cycle",
    category: "animation",
    promptTemplate:
      "A readable walk cycle in place for {subject}, facing {direction}. Keep the silhouette, palette, and proportions consistent. Loop cleanly.",
    defaults: { frameCount: 8, fps: 8, loop: true },
    updatedAt: "Built-in",
  },
  {
    schemaVersion: 1,
    id: "skill-pixel-prop",
    name: "Pixel-art game prop",
    category: "asset",
    promptTemplate:
      "{subject}, crisp pixel art with a limited palette, clear silhouette, transparent background, centered on canvas.",
    defaults: { size: "64", pixelArt: true, transparentBackground: true },
    updatedAt: "Built-in",
  },
];

export function parseSkill(value: unknown): SavedSkill | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedSkill>;
  if (typeof candidate.name !== "string" || typeof candidate.promptTemplate !== "string") return null;
  const categories: SavedSkill["category"][] = ["animation", "asset", "character", "general"];
  const defaults = candidate.defaults && typeof candidate.defaults === "object" ? candidate.defaults : {};
  const size = defaults.size && ["64", "128", "512", "custom"].includes(defaults.size) ? defaults.size : undefined;
  const normalized = {
    schemaVersion: 1,
    id: typeof candidate.id === "string" ? candidate.id : makeId(),
    name: candidate.name,
    category: categories.includes(candidate.category as SavedSkill["category"])
      ? (candidate.category as SavedSkill["category"])
      : "general",
    description: typeof candidate.description === "string" ? candidate.description : undefined,
    promptTemplate: candidate.promptTemplate,
    negativePrompt: typeof candidate.negativePrompt === "string" ? candidate.negativePrompt : undefined,
    defaults: {
      ...(size ? { size } : {}),
      ...(typeof defaults.pixelArt === "boolean" ? { pixelArt: defaults.pixelArt } : {}),
      ...(typeof defaults.transparentBackground === "boolean"
        ? { transparentBackground: defaults.transparentBackground }
        : {}),
      ...(typeof defaults.frameCount === "number" ? { frameCount: defaults.frameCount } : {}),
      ...(typeof defaults.fps === "number" ? { fps: defaults.fps } : {}),
      ...(typeof defaults.loop === "boolean" ? { loop: defaults.loop } : {}),
    },
    workflowNotes: Array.isArray(candidate.workflowNotes)
      ? candidate.workflowNotes.filter((note): note is string => typeof note === "string")
      : [],
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "Imported",
  };
  const parsed = savedSkillSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

export function renderSkillMarkdown(skills: SavedSkill[]) {
  return [
    "# Sprite Studio Skills",
    "",
    ...skills.flatMap((skill) => [
      `## ${skill.name}`,
      "",
      `<!-- sprite-studio-skill: ${JSON.stringify(skill)} -->`,
      `Category: ${skill.category}`,
      ...(skill.description ? ["", skill.description] : []),
      "",
      "### Prompt template",
      "```text",
      skill.promptTemplate,
      "```",
      ...(skill.negativePrompt ? ["", "### Negative prompt", "```text", skill.negativePrompt, "```"] : []),
      "",
    ]),
  ].join("\n");
}

export function fillSkillTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => variables[key] ?? `{${key}}`);
}

export function skillPlaceholders(template: string) {
  return [...new Set(Array.from(template.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (match) => match[1]))];
}

export function parseSkillsMarkdown(markdown: string) {
  const skills: SavedSkill[] = [];
  const metadataPattern = /<!--\s*sprite-studio-skill:\s*(\{[^\n]*\})\s*-->/g;
  for (const match of markdown.matchAll(metadataPattern)) {
    try {
      const skill = parseSkill(JSON.parse(match[1]));
      if (skill) skills.push(skill);
    } catch {
      // Ignore malformed metadata blocks and continue parsing valid skills.
    }
  }
  if (skills.length) return skills;
  const sections = markdown.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const name = section.split("\n")[0]?.trim();
    const prompt = section.match(/### Prompt template\s*```text\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
    const category = section.match(/^Category:\s*(animation|asset|character|general)\s*$/im)?.[1] as
      SavedSkill["category"] | undefined;
    if (name && prompt)
      skills.push({
        schemaVersion: 1,
        id: makeId(),
        name,
        category: category ?? "general",
        promptTemplate: prompt,
        defaults: {},
        updatedAt: "Imported",
      });
  }
  return skills;
}
