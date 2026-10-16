import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";

import { instructionFiles, promptText, reminder } from "../plugin/hellstack/index.ts";
import {
  buildPluginsRepo,
  buildSkillsRepo,
  localSkills,
  pluginName,
  skillOf,
  skillsDir,
} from "../src/build.ts";

const skills = await buildSkillsRepo();
const plugins = await buildPluginsRepo();

test("the skills repository has every skill except the local skills", () => {
  const names = new Set([...skills.keys()].map(skillOf));
  const all = readdirSync(skillsDir);
  expect([...names].sort()).toEqual(all.filter((name) => !localSkills.includes(name)).sort());
  expect(localSkills.filter((name) => !all.includes(name))).toEqual([]);
});

test("the skills repository is in the limits of an Amp-hosted repository", () => {
  const size = [...skills.values()].reduce((sum, file) => sum + file.content.length, 0);
  const counts = Map.groupBy([...skills.keys()], skillOf);
  expect(counts.size).toBeLessThanOrEqual(200);
  expect([...counts].filter(([, files]) => files.length > 200).map(([name]) => name)).toEqual([]);
  expect(size).toBeLessThan(25 * 1024 * 1024);
});

test("the plugin has its instruction files", () => {
  const missing = instructionFiles.filter((name) => !plugins.has(`${pluginName}/${name}`));
  expect(missing).toEqual([]);
});

test("the first prompt of a thread gets the instructions, and later prompts get the reminder", () => {
  const started = new Set<string>();
  expect(promptText(started, "T-1", "all")).toBe("all");
  expect(promptText(started, "T-1", "all")).toBe(reminder);
  expect(promptText(started, "T-2", "all")).toBe("all");
});
