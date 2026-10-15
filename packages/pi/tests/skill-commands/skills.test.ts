import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SlashCommandInfo, SourceInfo } from "@earendil-works/pi-coding-agent";

import { expandSkills, type SkillCommand, skillCommands } from "../../src/skill-commands/skills.ts";

let root: string;
let skills: SkillCommand[];

async function writeSkill(name: string): Promise<SkillCommand> {
  const filePath = path.join(root, name, "SKILL.md");
  await Bun.write(filePath, `---\nname: ${name}\ndescription: d\n---\n\nDo ${name}.\n`);
  return { name, description: "d", filePath };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "skill-commands-"));
  skills = [await writeSkill("jira"), await writeSkill("browser")];
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function command(name: string, source: SlashCommandInfo["source"]): SlashCommandInfo {
  const sourceInfo: SourceInfo = {
    path: `/s/${name}`,
    source: "local",
    scope: "user",
    origin: "top-level",
  };
  return { name, source, sourceInfo };
}

test("skillCommands keeps skills, without the ones that a command or template hides", () => {
  const commands = [
    command("skill:jira", "skill"),
    command("skill:todos", "skill"),
    command("todos", "extension"),
    command("skill:review", "skill"),
    command("review", "prompt"),
  ];

  expect(skillCommands(commands)).toEqual([
    { name: "jira", description: undefined, filePath: "/s/skill:jira" },
  ]);
});

test("expandSkills adds a block for each named skill before the text", async () => {
  const text = "use /browser and then /jira and /browser again, not /missing";
  const result = await expandSkills(text, skills);
  const jira = skills[0]?.filePath ?? "";

  expect(result?.match(/<skill name="(\w+)"/g)).toEqual([
    '<skill name="browser"',
    '<skill name="jira"',
  ]);
  expect(result).toContain(
    `<skill name="jira" location="${jira}">\nReferences are relative to ${path.dirname(jira)}.\n\nDo jira.\n</skill>`,
  );
  expect(result).toEndWith(`</skill>\n\n${text}`);
});

test("expandSkills returns undefined when the text names no skill", async () => {
  expect(await expandSkills("hello /missing", skills)).toBeUndefined();
});
