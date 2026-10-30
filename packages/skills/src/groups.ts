import { z } from "zod";

import { type SkillsLock, skillDirs } from "./lock.ts";
import type { Upstream } from "./upstream.ts";

/**
 * Returns the skill groups by name. All the skills from `upstream.json` (pstack, thermos, and
 * cursor-team-kit) are in the `pstack` group. A skill from `skills-lock.json` is in the group of its
 * source, for example `herdrdev/herdr`. The values are skill directory names in `skills/`.
 */
export function skillGroups(upstream: Upstream, lock: SkillsLock): Map<string, string[]> {
  const groups = new Map<string, string[]>([["pstack", Object.keys(upstream.skills)]]);
  const dirs = skillDirs(lock);
  Object.values(lock.skills).forEach((entry, i) => addTo(groups, entry.source, String(dirs[i])));
  return groups;
}

function addTo(groups: Map<string, string[]>, group: string, skill: string): void {
  groups.set(group, [...(groups.get(group) ?? []), skill]);
}

const packageSchema = z.union([
  z.string(),
  z.looseObject({ source: z.string(), skills: z.array(z.string()).optional() }),
]);

const settingsSchema = z.looseObject({ packages: z.array(packageSchema).default([]) });

type Package = z.infer<typeof packageSchema>;

function sourceOf(entry: Package): string {
  return typeof entry === "string" ? entry : entry.source;
}

function excludePattern(skill: string): string {
  return `-skills/${skill}`;
}

function filtersOf(entry: Package | undefined): string[] {
  return typeof entry === "object" ? (entry.skills ?? []) : [];
}

function withFilters(entry: Package, filters: string[]): Package {
  const { skills: _, ...rest } = typeof entry === "string" ? { source: entry } : entry;
  if (filters.length > 0) return { ...rest, skills: filters };
  return Object.keys(rest).length === 1 ? rest.source : rest;
}

function updateFilters(entry: Package, patterns: Set<string>, enabled: boolean): Package {
  const kept = filtersOf(entry).filter((filter) => !patterns.has(filter));
  return withFilters(entry, enabled ? kept : [...kept, ...patterns]);
}

/**
 * Returns the pi settings with the skills turned off or on in the package at `source`. It adds or
 * removes a `-skills/<name>` filter for each skill, and keeps the other filters. Pi keeps these
 * settings across restarts.
 */
export function setSkillsEnabled(
  settings: unknown,
  source: string,
  skills: readonly string[],
  enabled: boolean,
): Record<string, unknown> {
  const parsed = settingsSchema.parse(settings);
  const patterns = new Set(skills.map(excludePattern));
  if (!parsed.packages.some((entry) => sourceOf(entry) === source)) {
    throw new Error(`The pi settings do not load ${source}. Run \`bun run sync\` first.`);
  }
  const packages = parsed.packages.map((entry) =>
    sourceOf(entry) === source ? updateFilters(entry, patterns, enabled) : entry,
  );
  return { ...parsed, packages };
}

/** Returns the skills of the package at `source` that the pi settings turn off. */
export function disabledSkills(settings: unknown, source: string): string[] {
  const entry = settingsSchema.parse(settings).packages.find((e) => sourceOf(e) === source);
  return filtersOf(entry)
    .filter((f) => f.startsWith("-skills/"))
    .map((f) => f.slice("-skills/".length));
}
