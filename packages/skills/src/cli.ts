import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { disabledSkills, setSkillsEnabled, skillGroups } from "./groups.ts";
import { groupBySource, parseLock } from "./lock.ts";
import { readUpstream } from "./upstream.ts";

/** The package directory. The skills CLI uses it as the project root. */
const packageDir = join(import.meta.dir, "..");

/**
 * The skills CLI installs project skills for OpenClaw into `<project>/skills`, which is the
 * directory that this package keeps its skills in. `--copy` writes real files, not symlinks.
 */
const installFlags = ["--agent", "openclaw", "--copy", "-y"];

const usage = `Usage:
  bun run skills:add <source> <skill...>   Install skills from a skills.sh source
  bun run skills:update [skill...]         Update installed skills.sh skills
  bun run skills:remove <skill...>         Remove installed skills.sh skills
  bun run skills:groups                    Show the skill groups and which are off in pi
  bun run skills:disable <group...>        Turn off the skills of a group in pi
  bun run skills:enable <group...>         Turn on the skills of a group in pi

Find the skills in a source with: bunx skills add <source> --list`;

function runSkills(args: string[]): boolean {
  const result = Bun.spawnSync([process.execPath, "x", "skills", ...args], {
    cwd: packageDir,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return result.success;
}

function add([source, ...skills]: string[]): boolean {
  if (source === undefined || skills.length === 0) {
    console.error(usage);
    return false;
  }
  return runSkills(["add", source, ...installFlags, "--skill", ...skills]);
}

async function update(names: string[]): Promise<boolean> {
  const lockPath = join(packageDir, "skills-lock.json");
  if (!existsSync(lockPath)) {
    console.log("No skills.sh skills are installed.");
    return true;
  }
  const groups = groupBySource(parseLock(await Bun.file(lockPath).text()), names);
  const results = groups.map((group) => add([group.source, ...group.skills]));
  return results.every(Boolean);
}

function remove(skills: string[]): boolean {
  if (skills.length === 0) {
    console.error(usage);
    return false;
  }
  return runSkills(["remove", ...skills, "--agent", "openclaw", "-y"]);
}

const settingsPath = join(
  process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent"),
  "settings.json",
);

async function readGroups(): Promise<Map<string, string[]>> {
  const lockPath = join(packageDir, "skills-lock.json");
  const lock = existsSync(lockPath) ? parseLock(await Bun.file(lockPath).text()) : { skills: {} };
  return skillGroups(await readUpstream(), lock);
}

async function readSettings(): Promise<unknown> {
  return JSON.parse(await Bun.file(settingsPath).text());
}

async function listGroups(): Promise<boolean> {
  const off = new Set(disabledSkills(await readSettings(), packageDir));
  for (const [group, skills] of await readGroups()) {
    const count = skills.filter((skill) => off.has(skill)).length;
    const state = count === 0 ? "on" : count === skills.length ? "off" : `${count} off`;
    console.log(`${group} (${skills.length} skills): ${state}`);
  }
  return true;
}

async function setGroups(names: string[], enabled: boolean): Promise<boolean> {
  const groups = await readGroups();
  const unknown = names.filter((name) => !groups.has(name));
  if (names.length === 0 || unknown.length > 0) {
    console.error(`Give one or more of these groups: ${[...groups.keys()].join(", ")}`);
    return false;
  }
  const skills = names.flatMap((name) => groups.get(name) ?? []);
  const settings = setSkillsEnabled(await readSettings(), packageDir, skills, enabled);
  await Bun.write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`${enabled ? "Enabled" : "Disabled"} ${skills.length} skills. Run /reload in pi.`);
  return true;
}

const commands: Record<string, (args: string[]) => boolean | Promise<boolean>> = {
  add,
  update,
  remove,
  groups: listGroups,
  disable: (args) => setGroups(args, false),
  enable: (args) => setGroups(args, true),
};

async function main([command = "", ...args]: string[]): Promise<boolean> {
  const run = commands[command];
  if (run) return run(args);
  console.error(usage);
  return false;
}

try {
  if (!(await main(process.argv.slice(2)))) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
