import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Entry } from "../src/plan.ts";
import { resolveRoots, type Roots } from "../src/roots.ts";
import { sync, type SyncResult } from "../src/sync.ts";

let home: string;
let roots: Roots;
let skillSource: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "hellstack-sync-"));
  roots = resolveRoots(home, {});
  skillSource = join(home, "repo", "skills", "demo");
  await mkdir(join(skillSource, "scripts"), { recursive: true });
  await writeFile(join(skillSource, "SKILL.md"), "# demo\n");
  await writeFile(join(skillSource, "scripts", "run"), "#!/bin/sh\n", { mode: 0o755 });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function fileEntry(target: string, text: string): Entry {
  return { kind: "file", target, file: { content: new TextEncoder().encode(text), mode: 0o644 } };
}

function skillEntry(): Entry {
  return { kind: "dir", target: join(roots.claude, "skills", "demo"), source: skillSource };
}

function run(entries: Entry[], dryRun = false): Promise<SyncResult> {
  return sync({ entries, roots, dryRun, log: () => undefined });
}

function kinds(result: SyncResult): string[] {
  return result.actions.map((action) => `${action.kind}${action.backup ? "+backup" : ""}`);
}

test("a second sync has no changes", async () => {
  const entries = [fileEntry(join(roots.claude, "CLAUDE.md"), "hello\n"), skillEntry()];
  expect(kinds(await run(entries))).toEqual(["create", "create"]);
  const second = await run(entries);
  expect(second.actions).toEqual([]);
  expect(second.unchanged).toBe(2);
});

test("a skill copy keeps the executable bit of its scripts", async () => {
  await run([skillEntry()]);
  const script = await stat(join(roots.claude, "skills", "demo", "scripts", "run"));
  expect(script.mode & 0o777).toBe(0o755);
});

test("a dry run does not change files", async () => {
  const target = join(roots.claude, "CLAUDE.md");
  expect(kinds(await run([fileEntry(target, "hello\n")], true))).toEqual(["create"]);
  expect(await readFile(target, "utf8").catch(() => "missing")).toBe("missing");
});

test("the sync removes a target that it wrote before and that is not an entry now", async () => {
  await run([skillEntry()]);
  expect(kinds(await run([]))).toEqual(["remove"]);
  expect(await readdir(join(roots.claude, "skills"))).toEqual([]);
});

test("the sync backs up a local edit before it overwrites it", async () => {
  const target = join(roots.pi, "settings.json");
  await run([fileEntry(target, "{}\n")]);
  await writeFile(target, '{ "theme": "dayowl" }\n');
  expect(kinds(await run([fileEntry(target, "{}\n")]))).toEqual(["update+backup"]);
  const [stamp] = await readdir(join(roots.state, "backups"));
  const backup = join(roots.state, "backups", String(stamp), ".pi", "agent", "settings.json");
  expect(await readFile(backup, "utf8")).toBe('{ "theme": "dayowl" }\n');
  expect(await readFile(target, "utf8")).toBe("{}\n");
});

test("the sync does not back up a file that it wrote itself", async () => {
  const target = join(roots.claude, "CLAUDE.md");
  await run([fileEntry(target, "old\n")]);
  expect(kinds(await run([fileEntry(target, "new\n")]))).toEqual(["update"]);
});

test("the sync replaces a symbolic link and does not change the file it points to", async () => {
  const linked = join(home, "dotfiles", "demo");
  await mkdir(linked, { recursive: true });
  await writeFile(join(linked, "SKILL.md"), "# old\n");
  await mkdir(join(roots.claude, "skills"), { recursive: true });
  await symlink(linked, join(roots.claude, "skills", "demo"));
  expect(kinds(await run([skillEntry()]))).toEqual(["update+backup"]);
  expect(await readFile(join(linked, "SKILL.md"), "utf8")).toBe("# old\n");
  expect(await readFile(join(roots.claude, "skills", "demo", "SKILL.md"), "utf8")).toBe("# demo\n");
});

test("the manifest records the targets after the integrations run", async () => {
  const target = join(roots.claude, "settings.json");
  const entries = [fileEntry(target, "{}\n")];
  async function afterApply(): Promise<void> {
    await writeFile(target, '{ "hooks": {} }\n');
  }
  await sync({ entries, roots, dryRun: false, log: () => undefined, afterApply });
  expect(kinds(await run(entries))).toEqual(["update"]);
});
