import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSlug } from "./ids.ts";
import {
  fillSkillTemplate,
  parseSkill,
  parseSkillsMarkdown,
  renderSkillMarkdown,
  skillPlaceholders,
  starterSkills,
} from "./skills.ts";

test("makeSlug normalizes names and keeps a stable id suffix", () => {
  assert.equal(makeSlug("  Hello, World! ", "abcd1234efgh"), "hello-world-abcd1234");
  assert.equal(makeSlug("Café Über", "1234567890"), "cafe-uber-12345678");
  assert.equal(makeSlug("!!!", "abcdef0000"), "item-abcdef00");
});

test("fillSkillTemplate substitutes known variables and preserves unknown ones", () => {
  assert.equal(fillSkillTemplate("A {subject} facing {direction}", { subject: "cat" }), "A cat facing {direction}");
});

test("skillPlaceholders returns unique placeholder names in order", () => {
  assert.deepEqual(skillPlaceholders("{a} {b} {a} {c}"), ["a", "b", "c"]);
});

test("parseSkill normalizes unknown categories and defaults", () => {
  const skill = parseSkill({ name: "X", promptTemplate: "t", category: "bogus", defaults: { fps: 12, loop: true } });
  assert.ok(skill);
  assert.equal(skill?.category, "general");
  assert.equal(skill?.defaults.fps, 12);
  assert.equal(skill?.defaults.loop, true);
  assert.equal(parseSkill(null), null);
  assert.equal(parseSkill({ name: "missing template" }), null);
});

test("skills survive a markdown render and parse round trip", () => {
  const markdown = renderSkillMarkdown(starterSkills);
  const parsed = parseSkillsMarkdown(markdown);
  assert.equal(parsed.length, starterSkills.length);
  assert.deepEqual(
    parsed.map((skill) => skill.name),
    starterSkills.map((skill) => skill.name)
  );
});

test("parseSkillsMarkdown falls back to section parsing without metadata", () => {
  const markdown = [
    "# Sprite Studio Skills",
    "",
    "## My Walk",
    "Category: animation",
    "",
    "### Prompt template",
    "```text",
    "walk cycle for {subject}",
    "```",
  ].join("\n");
  const parsed = parseSkillsMarkdown(markdown);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "My Walk");
  assert.equal(parsed[0].category, "animation");
  assert.equal(parsed[0].promptTemplate, "walk cycle for {subject}");
});
