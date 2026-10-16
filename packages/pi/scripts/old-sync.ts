import { createHash } from "node:crypto";
import { readFile, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const ManifestSchema = z.object({ entries: z.record(z.string(), z.string()) });

/** Where the old copy-based sync wrote the files that pi now loads from this repository. */
export interface OldSyncPlaces {
  /** The pi agent directory. */
  agentDir: string;
  /** The skill directories that the old sync wrote to. */
  skillDirs: string[];
  /** The names of the skills in this repository. */
  repoSkills: string[];
}

function isRepoSkillCopy(file: string, places: OldSyncPlaces): boolean {
  return places.skillDirs.some((dir) => {
    const [name, ...rest] = path.relative(dir, file).split(path.sep);
    return rest.length > 0 && name !== ".." && places.repoSkills.includes(name!);
  });
}

/**
 * Returns the files of the old manifest that pi now gets from this repository: the copied
 * `AGENTS.md`, the copied pstack package, and the copies of the repository skills. Private skills
 * and settings files are not in the list.
 */
export function replacedFiles(files: string[], places: OldSyncPlaces): string[] {
  const pstack = path.join(places.agentDir, "vendor", "pstack") + path.sep;
  const agents = path.join(places.agentDir, "AGENTS.md");
  return files.filter(
    (file) => file === agents || file.startsWith(pstack) || isRepoSkillCopy(file, places),
  );
}

async function sha256(file: string): Promise<string | undefined> {
  const data = await readFile(file).catch(() => undefined);
  return data && createHash("sha256").update(data).digest("hex");
}

async function removeEmptyDirs(files: string[], roots: string[]): Promise<void> {
  const dirs = [...new Set(files.map((file) => path.dirname(file)))].sort().reverse();
  const inRoots = dirs.filter((dir) => roots.some((root) => dir.startsWith(root + path.sep)));
  for (const dir of inRoots) await rmdir(dir).catch(() => undefined);
}

/**
 * Removes the files that the old sync wrote and that pi now gets from this repository. It removes a
 * file only when it is the same as the old sync wrote it. Then it removes the manifest, so it runs
 * one time. It returns the files that it kept because they changed.
 */
export async function removeOldSync(manifest: string, places: OldSyncPlaces): Promise<string[]> {
  const text = await readFile(manifest, "utf8").catch(() => undefined);
  if (text === undefined) return [];
  const { entries } = ManifestSchema.parse(JSON.parse(text));
  const candidates = replacedFiles(Object.keys(entries), places);
  const hashes = await Promise.all(candidates.map(sha256));
  const same = candidates.filter((file, index) => hashes[index] === entries[file]);
  await Promise.all(same.map((file) => rm(file, { force: true })));
  await removeEmptyDirs(same, [places.agentDir, ...places.skillDirs]);
  await rm(manifest);
  return candidates.filter((file, index) => ![undefined, entries[file]].includes(hashes[index]));
}
