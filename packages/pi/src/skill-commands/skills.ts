import { readFile } from "node:fs/promises";
import path from "node:path";

import { type SlashCommandInfo, stripFrontmatter } from "@earendil-works/pi-coding-agent";

import { skillRefs } from "../shared/skill-refs.ts";

const SKILL_PREFIX = "skill:";

/** A skill that the user can start with `/name`. */
export interface SkillCommand {
  name: string;
  description: string | undefined;
  filePath: string;
}

/**
 * Gets the skills from the commands of pi. A skill that has the name of a command or a prompt
 * template is not in the list, because the command or the template runs for `/name`.
 */
export function skillCommands(commands: readonly SlashCommandInfo[]): SkillCommand[] {
  const others = new Set(commands.filter((c) => c.source !== "skill").map((c) => c.name));

  return commands
    .filter((command) => command.source === "skill")
    .map((command) => ({
      name: command.name.slice(SKILL_PREFIX.length),
      description: command.description,
      filePath: command.sourceInfo.path,
    }))
    .filter((skill) => !others.has(skill.name));
}

/** Makes the same `<skill>` block that pi makes for `/skill:name`. */
async function skillBlock(skill: SkillCommand): Promise<string> {
  const body = stripFrontmatter(await readFile(skill.filePath, "utf8")).trim();
  const baseDir = path.dirname(skill.filePath);

  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
}

/**
 * Adds a `<skill>` block before the text for each skill that the text names with `/name` or
 * `/skill:name`. Returns undefined if the text names no skill.
 */
export async function expandSkills(
  text: string,
  skills: readonly SkillCommand[],
): Promise<string | undefined> {
  const names = skillRefs(text);
  const used = names.flatMap((name) => skills.filter((skill) => skill.name === name));
  if (used.length === 0) return undefined;
  const blocks = await Promise.all(used.map(skillBlock));

  return [...blocks, text].join("\n\n");
}
