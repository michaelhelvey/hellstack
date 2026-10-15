import { rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { classify, isInside } from "./artifacts.ts";
import { isCacheDirectory, type ToolCache } from "./caches.ts";
import { exists } from "./fs.ts";

/** A thing that the cleanup can remove. */
export interface Target {
  /** The tool cache identifier or the path, as the user gave it. */
  label: string;
  remove(): Promise<void>;
}

function removePath(path: string): Target {
  return { label: path, remove: () => rm(path, { recursive: true, force: true }) };
}

async function pathTarget(argument: string, roots: string[]): Promise<Target> {
  if (!isAbsolute(argument)) throw new Error(`${argument}: give an absolute path`);

  const path = resolve(argument);

  if (!(await exists(path))) throw new Error(`${path}: does not exist`);

  if (isCacheDirectory(path)) return removePath(path);

  if (isInside(path, roots) && (await classify(path))) return removePath(path);

  throw new Error(`${path}: not a cache directory or a project artifact in ${roots.join(", ")}`);
}

/**
 * Gives the target for each argument. An argument is a tool cache identifier or the absolute path
 * of an artifact or a cache directory. The function uses the same rules as the scan, so that the
 * cleanup cannot remove source code. It throws when one argument does not obey the rules.
 */
export async function resolveTargets(
  args: string[],
  caches: ToolCache[],
  roots: string[],
): Promise<Target[]> {
  return Promise.all(
    args.map(async (argument) => {
      const cache = caches.find((candidate) => candidate.id === argument);

      if (cache) return { label: cache.id, remove: () => cache.clean() };

      return pathTarget(argument, roots);
    }),
  );
}
