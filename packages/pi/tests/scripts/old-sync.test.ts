import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { removeOldSync, replacedFiles } from "../../scripts/old-sync.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "hellstack-old-sync-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function places() {
  const agentDir = path.join(home, "agent");
  const skillDirs = [path.join(agentDir, "skills"), path.join(home, "claude", "skills")];
  return { agentDir, skillDirs, repoSkills: ["pr"] };
}

function inAgent(file: string): string {
  return path.join(places().agentDir, file);
}

test("replacedFiles selects AGENTS.md, pstack, and copies of repository skills only", () => {
  const claude = path.join(home, "claude", "skills", "pr", "SKILL.md");
  const replaced = [
    inAgent("AGENTS.md"),
    inAgent("vendor/pstack/skills/x/SKILL.md"),
    inAgent("skills/pr/SKILL.md"),
    claude,
  ];
  const kept = [inAgent("settings.json"), inAgent("skills/private/SKILL.md")];
  expect(replacedFiles([...kept, ...replaced], places())).toEqual(replaced);
});

async function write(file: string, text: string): Promise<[string, string]> {
  await Bun.write(file, text);
  return [file, createHash("sha256").update(text).digest("hex")];
}

test("removeOldSync removes unchanged files, keeps changed files, and runs one time", async () => {
  const { agentDir } = places();
  const same = await write(path.join(agentDir, "skills", "pr", "SKILL.md"), "pr");
  const [changed] = await write(path.join(agentDir, "AGENTS.md"), "mine");
  const manifest = path.join(home, "manifest.json");
  await Bun.write(
    manifest,
    JSON.stringify({ entries: Object.fromEntries([same, [changed, "x"]]) }),
  );

  expect(await removeOldSync(manifest, places())).toEqual([changed]);
  expect(existsSync(same[0])).toBe(false);
  expect(existsSync(path.dirname(same[0]))).toBe(false);
  expect(existsSync(changed)).toBe(true);
  expect(existsSync(manifest)).toBe(false);
  expect(await removeOldSync(manifest, places())).toEqual([]);
});
