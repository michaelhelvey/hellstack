import { existsSync } from "node:fs";
import { join } from "node:path";

import { groupBySource, parseLock } from "./lock.ts";

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

async function main([command, ...args]: string[]): Promise<boolean> {
  switch (command) {
    case "add":
      return add(args);
    case "update":
      return update(args);
    case "remove":
      return remove(args);
    default:
      console.error(usage);
      return false;
  }
}

try {
  if (!(await main(process.argv.slice(2)))) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
