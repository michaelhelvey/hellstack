import { join, relative } from "node:path";

import { type Manifest, readManifest, writeManifest } from "./manifest.ts";
import type { Entry } from "./entries.ts";
import type { Roots } from "./roots.ts";
import { copyTree, hashFile, hashPath, removePath, writeFileData } from "./tree.ts";

/** A change that the sync makes to one target. */
export interface Action {
  kind: "create" | "update" | "remove";
  target: string;
  /** The entry to write. It is `undefined` for a `remove` action. */
  entry: Entry | undefined;
  /**
   * True when the target has changes that the last sync did not write, for example an edit that a
   * harness made. The sync copies the target to the backup directory before it changes it.
   */
  backup: boolean;
}

/** The input for {@link sync}. */
export interface SyncOptions {
  entries: Entry[];
  roots: Roots;
  /** When true, the sync shows the actions but does not change files. */
  dryRun: boolean;
  /** Receives one line of output for each action. */
  log: (line: string) => void;
  /** Runs after the sync writes the files, and before it records the new manifest. */
  afterApply?: () => Promise<void>;
}

/** The result of {@link sync}. */
export interface SyncResult {
  actions: Action[];
  unchanged: number;
}

async function entryHash(entry: Entry): Promise<string | undefined> {
  return entry.kind === "file" ? hashFile(entry.file) : hashPath(entry.source);
}

async function writeAction(entry: Entry, manifest: Manifest): Promise<Action | undefined> {
  const current = await hashPath(entry.target);
  if (current === (await entryHash(entry))) return undefined;
  const kind = current === undefined ? "create" : "update";
  const backup = current !== undefined && manifest[entry.target] !== current;
  return { kind, target: entry.target, entry, backup };
}

async function removeAction(target: string, manifest: Manifest): Promise<Action | undefined> {
  const current = await hashPath(target);
  if (current === undefined) return undefined;
  return { kind: "remove", target, entry: undefined, backup: manifest[target] !== current };
}

/**
 * Compares the entries with the harness directories. It makes a `remove` action for each target
 * that the last sync wrote and that is not an entry now.
 */
export async function planActions(entries: Entry[], manifest: Manifest): Promise<SyncResult> {
  const targets = new Set(entries.map((entry) => entry.target));
  const stale = Object.keys(manifest).filter((target) => !targets.has(target));
  const writes = await Promise.all(entries.map((entry) => writeAction(entry, manifest)));
  const removes = await Promise.all(stale.map((target) => removeAction(target, manifest)));
  const actions = [...writes, ...removes].filter((action) => action !== undefined);
  return { actions, unchanged: entries.length - writes.filter(Boolean).length };
}

/** Shows a path relative to the home directory, with a `~` prefix. */
export function displayPath(path: string, home: string): string {
  return path.startsWith(`${home}/`) ? `~/${relative(home, path)}` : path;
}

function backupPath(target: string, roots: Roots, stamp: string): string {
  const inside = target.startsWith(`${roots.home}/`);
  return join(roots.state, "backups", stamp, inside ? relative(roots.home, target) : target);
}

async function applyEntry(entry: Entry | undefined, target: string): Promise<void> {
  if (entry === undefined) return removePath(target);
  if (entry.kind === "file") return writeFileData(target, entry.file);
  return copyTree(entry.source, target);
}

async function applyAction(action: Action, options: SyncOptions, stamp: string): Promise<void> {
  const { roots, log } = options;
  if (action.backup) {
    const backup = backupPath(action.target, roots, stamp);
    log(`backup  ${displayPath(action.target, roots.home)} -> ${displayPath(backup, roots.home)}`);
    if (!options.dryRun) await copyTree(action.target, backup);
  }
  log(`${action.kind.padEnd(7)} ${displayPath(action.target, roots.home)}`);
  if (!options.dryRun) await applyEntry(action.entry, action.target);
}

async function recordManifest(path: string, entries: Entry[]): Promise<void> {
  const manifest: Manifest = {};
  for (const entry of entries) {
    const hash = await hashPath(entry.target);
    if (hash !== undefined) manifest[entry.target] = hash;
  }
  await writeManifest(path, manifest);
}

/**
 * Writes the entries to the harness directories. It backs up local changes before it overwrites
 * them, removes the targets that the last sync wrote and that are not entries now, and records the
 * new manifest.
 */
export async function sync(options: SyncOptions): Promise<SyncResult> {
  const manifestPath = join(options.roots.state, "manifest.json");
  const result = await planActions(options.entries, await readManifest(manifestPath));
  const stamp = new Date().toISOString().replaceAll(":", "-");
  for (const action of result.actions) await applyAction(action, options, stamp);
  if (options.dryRun) return result;
  await options.afterApply?.();
  await recordManifest(manifestPath, options.entries);
  return result;
}
