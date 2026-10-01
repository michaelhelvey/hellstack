import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import type { SyncContext, SyncPlan, SyncPlanner } from "./define.ts";
import type { Entry } from "./entries.ts";
import type { Integration } from "./integrations.ts";
import type { Layers } from "./layers.ts";
import type { Roots } from "./roots.ts";

/** The file name of the sync manifest at the root of a package. */
export const manifestFileName = "hellstack.sync.ts";

const manifestModuleSchema = z.object({
  default: z.object({
    plan: z.custom<SyncPlanner>((value) => typeof value === "function"),
  }),
});

/** All the entries and integrations of the repository. */
export interface RepoPlan {
  entries: Entry[];
  integrations: Integration[];
}

async function manifestDirs(packagesDir: string): Promise<string[]> {
  const dirents = await readdir(packagesDir, { withFileTypes: true });
  const dirs = dirents.filter((d) => d.isDirectory()).map((d) => join(packagesDir, d.name));
  const found = await Promise.all(
    dirs.map((dir) => Bun.file(join(dir, manifestFileName)).exists()),
  );
  return dirs.filter((_, index) => found[index]).sort();
}

async function packagePlan(packageDir: string, roots: Roots, layers: Layers): Promise<SyncPlan> {
  const path = join(packageDir, manifestFileName);
  const parsed = manifestModuleSchema.safeParse(await import(path));
  if (!parsed.success) throw new Error(`${path} does not export a manifest from defineSync`);
  const context: SyncContext = { packageDir, roots, layers };
  return parsed.data.default.plan(context);
}

function checkTargets(entries: Entry[]): void {
  const seen = new Set<string>();
  for (const { target } of entries) {
    if (seen.has(target)) throw new Error(`two entries write to ${target}`);
    seen.add(target);
  }
}

/**
 * Loads the sync manifest of each package in `<repo>/packages` and makes the plan for the layers.
 * It loads the packages in name order, so the integrations run in that order. It throws an error
 * when two entries write to the same target.
 */
export async function planRepo(repo: string, roots: Roots, layers: Layers): Promise<RepoPlan> {
  const dirs = await manifestDirs(join(repo, "packages"));
  const plans = await Promise.all(dirs.map((dir) => packagePlan(dir, roots, layers)));
  const entries = plans.flatMap((plan) => plan.entries);
  checkTargets(entries);
  return { entries, integrations: plans.flatMap((plan) => plan.integrations ?? []) };
}
