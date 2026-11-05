import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { readIfExists, writeAtomic, type LedgerPaths } from "../core/index.ts";

/** The deepest folder level under a root that {@link findCheckout} searches. */
export const MAX_DEPTH = 3;

const cacheSchema = z.record(z.string(), z.string());

const ORIGIN = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/;

/** Returns the path of the checkout cache. */
export function checkoutCachePath(paths: LedgerPaths): string {
  return join(paths.state, "checkouts.json");
}

/** Returns `path` with a leading `~` replaced by the home folder. */
export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

/**
 * Returns the `owner/repo` of a remote URL, in lowercase, or undefined. It accepts each host, so
 * that an SSH host alias (`git@github-work:owner/repo.git`) also matches.
 */
export function remoteRepo(url: string): string | undefined {
  return /[:/]([^/:]+\/[^/:]+?)(?:\.git)?\/?$/.exec(url)?.[1]?.toLowerCase();
}

async function originRepo(folder: string): Promise<string | undefined> {
  const config = await readIfExists(join(folder, ".git", "config")).catch(() => undefined);
  const url = config === undefined ? undefined : ORIGIN.exec(config)?.[1];
  return url === undefined ? undefined : remoteRepo(url);
}

async function subfolders(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
    )
    .map((entry) => join(folder, entry.name));
}

/** A folder with `.git` (a folder, or the file of a worktree) is a checkout; the search stops there. */
async function isGitCheckout(folder: string): Promise<boolean> {
  return (await stat(join(folder, ".git")).catch(() => undefined)) !== undefined;
}

/** Searches `folder` and its subfolders down to `depth` levels for a checkout of `repo`. */
async function search(folder: string, repo: string, depth: number): Promise<string | undefined> {
  if (await isGitCheckout(folder)) return (await originRepo(folder)) === repo ? folder : undefined;
  return depth > 0 ? searchChildren(folder, repo, depth - 1) : undefined;
}

async function searchChildren(
  folder: string,
  repo: string,
  depth: number,
): Promise<string | undefined> {
  for (const child of await subfolders(folder)) {
    const found = await search(child, repo, depth);
    if (found) return found;
  }
  return undefined;
}

function parseCache(text: string): Record<string, string> {
  try {
    return cacheSchema.safeParse(JSON.parse(text)).data ?? {};
  } catch {
    return {};
  }
}

async function readCache(paths: LedgerPaths): Promise<Record<string, string>> {
  return parseCache((await readIfExists(checkoutCachePath(paths))) ?? "{}");
}

async function cached(paths: LedgerPaths, repo: string): Promise<string | undefined> {
  const folder = (await readCache(paths))[repo];
  return folder !== undefined && (await isGitCheckout(folder)) ? folder : undefined;
}

async function remember(paths: LedgerPaths, repo: string, folder: string): Promise<void> {
  const cache = { ...(await readCache(paths)), [repo]: folder };
  await mkdir(paths.state, { recursive: true });
  await writeAtomic(checkoutCachePath(paths), `${JSON.stringify(cache, null, 2)}\n`);
}

/**
 * Returns the local checkout of the GitHub repository `owner/repo`: a git checkout whose `origin`
 * remote is that repository, in one of `roots` down to {@link MAX_DEPTH} folder levels. It does not
 * look into a checkout. It keeps the result in `state/checkouts.json`. Returns undefined when it
 * finds none.
 */
export async function findCheckout(
  repo: string,
  roots: string[],
  paths: LedgerPaths,
): Promise<string | undefined> {
  const key = repo.toLowerCase();
  const hit = await cached(paths, key);
  if (hit) return hit;
  for (const root of roots) {
    const found = await search(expandHome(root), key, MAX_DEPTH);
    if (found) {
      await remember(paths, key, found);
      return found;
    }
  }
  return undefined;
}
