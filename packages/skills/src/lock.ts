import { basename, dirname } from "node:path";

import { z } from "zod";

const lockEntrySchema = z.object({
  source: z.string(),
  sourceType: z.string(),
  sourceUrl: z.string().optional(),
  ref: z.string().optional(),
  skillPath: z.string().optional(),
});

type LockEntry = z.infer<typeof lockEntrySchema>;

const lockSchema = z.object({
  skills: z.record(z.string(), lockEntrySchema),
});

/** The part of a `skills-lock.json` file that this package uses. */
export type SkillsLock = z.infer<typeof lockSchema>;

/** A set of skills that come from one source at one ref. */
export interface SourceGroup {
  /** The source argument for `skills add`, with `#ref` when the lock has a ref. */
  source: string;
  /** The names of the skills to install from the source. */
  skills: string[];
}

/** Parses the text of a `skills-lock.json` file. */
export function parseLock(text: string): SkillsLock {
  return lockSchema.parse(JSON.parse(text));
}

/**
 * Groups the skills in the lock by source, so that each source is fetched one time.
 * Skills from `node_modules` are not included, because skills.sh does not supply them.
 */
export function groupBySource(lock: SkillsLock, names: readonly string[] = []): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const [name, entry] of selectSkills(lock, names)) {
    const source = installSource(entry);
    const group = groups.get(source) ?? { source, skills: [] };
    group.skills.push(name);
    groups.set(source, group);
  }
  return [...groups.values()];
}

/**
 * Returns the directory name in `skills/` of each skill in the lock. The skills CLI installs a
 * skill into the directory that contains its `SKILL.md` file. A skill without a `skillPath` uses
 * its name as the directory name.
 */
export function skillDirs(lock: SkillsLock): string[] {
  return Object.entries(lock.skills).map(([name, entry]) =>
    entry.skillPath ? basename(dirname(entry.skillPath)) : name,
  );
}

function installSource(entry: LockEntry): string {
  const base = entry.sourceUrl ?? entry.source;
  return entry.ref ? `${base}#${entry.ref}` : base;
}

function selectSkills(lock: SkillsLock, names: readonly string[]) {
  const entries = Object.entries(lock.skills).filter(
    ([, entry]) => entry.sourceType !== "node_modules",
  );
  if (names.length === 0) return entries;
  const unknown = names.filter((name) => !(name in lock.skills));
  if (unknown.length > 0) {
    throw new Error(`These skills are not in skills-lock.json: ${unknown.join(", ")}`);
  }
  return entries.filter(([name]) => names.includes(name));
}
