import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { addPiPackage } from "./pi-settings.ts";
import type { Roots } from "./roots.ts";
import { type FileData, isCopied, listFiles, readFileData } from "./tree.ts";

/** One file or directory that the sync owns in a harness directory. */
export type Entry =
  | { kind: "file"; target: string; file: FileData }
  | { kind: "dir"; target: string; source: string };

/** Changes the text of a file before the sync writes it. */
export type Transform = (text: string) => string;

async function fileEntry(source: string, target: string, transform?: Transform): Promise<Entry> {
  const file = await readFileData(source);
  if (transform === undefined) return { kind: "file", target, file };
  const text = transform(new TextDecoder().decode(file.content));
  return { kind: "file", target, file: { ...file, content: new TextEncoder().encode(text) } };
}

/**
 * Makes one file entry for each file in a config directory. The config directory has the same
 * layout as the harness directory. A transform changes the file at its relative path.
 */
export async function configEntries(
  source: string,
  target: string,
  transforms: Record<string, Transform> = {},
): Promise<Entry[]> {
  const paths = await listFiles(source);
  return Promise.all(
    paths.map((path) => fileEntry(join(source, path), join(target, path), transforms[path])),
  );
}

/** Makes one directory entry for each skill, in each of the skill directories. */
export async function skillEntries(source: string, targets: string[]): Promise<Entry[]> {
  const dirents = await readdir(source, { withFileTypes: true });
  const names = dirents.filter((d) => d.isDirectory() && isCopied(d.name)).map((d) => d.name);
  return targets.flatMap((target) =>
    names.map((name): Entry => ({
      kind: "dir",
      target: join(target, name),
      source: join(source, name),
    })),
  );
}

async function instructionEntries(repo: string, roots: Roots): Promise<Entry[]> {
  const source = join(repo, "packages", "global", "AGENTS.md");
  const targets = [
    join(roots.claude, "CLAUDE.md"),
    join(roots.opencode, "AGENTS.md"),
    join(roots.pi, "AGENTS.md"),
  ];
  return Promise.all(targets.map((target) => fileEntry(source, target)));
}

/**
 * Makes all the entries for the repository at `repo`. Claude Code and opencode read skills from
 * `~/.claude/skills`, and pi reads them from `~/.pi/agent/skills`.
 */
export async function planEntries(repo: string, roots: Roots): Promise<Entry[]> {
  const packages = join(repo, "packages");
  const piPackage = join(packages, "pi");
  const groups = await Promise.all([
    instructionEntries(repo, roots),
    configEntries(join(packages, "claude-code", "config"), roots.claude),
    configEntries(join(packages, "opencode", "config"), roots.opencode),
    configEntries(join(piPackage, "agent"), roots.pi, {
      "settings.json": (text) => addPiPackage(text, piPackage),
    }),
    skillEntries(join(packages, "skills", "skills"), [
      join(roots.claude, "skills"),
      join(roots.pi, "skills"),
    ]),
  ]);
  return groups.flat();
}
