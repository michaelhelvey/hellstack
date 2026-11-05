import { type Dirent, existsSync } from "node:fs";
import { lstat, lutimes, mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** The folder with the personal Herdr desktop files of this repository. */
export const CONFIG_DIR = path.resolve(import.meta.dir, "../config");

/**
 * Links `target` to `source`. A link to another path is replaced. A file or folder at `target`
 * moves to `<target>.bak` first, because Herdr can write real files over a link.
 */
async function link(source: string, target: string): Promise<void> {
  const current = await readlink(target).catch(() => undefined);
  if (current === source) return;
  if (current === undefined && existsSync(target)) {
    await rm(`${target}.bak`, { recursive: true, force: true });
    await rename(target, `${target}.bak`);
    console.log(`herdr: moved ${target} to ${target}.bak`);
  }
  await rm(target, { force: true });
  await symlink(source, target);
}

/**
 * Links the mod folder `source` to `target`, then sets the time of the link itself. Herdr reloads a
 * mod when its folder in the app folder changes. It does not see changes behind the link, so the
 * new time makes it load the current files.
 */
async function linkMod(source: string, target: string): Promise<void> {
  await link(source, target);
  const now = new Date();
  await lutimes(target, now, now);
}

async function linkEntry(source: string, target: string, isDir: boolean): Promise<void> {
  if (!isDir) return link(source, target);
  if (existsSync(path.join(source, "mod.json"))) return linkMod(source, target);
  await linkFolder(target, source);
}

async function linkFolder(appDir: string, configDir: string): Promise<void> {
  if ((await lstat(appDir).catch(() => undefined))?.isSymbolicLink()) {
    throw new Error(`${appDir} is a link. Herdr owns this folder; make it a real folder.`);
  }
  await mkdir(appDir, { recursive: true });
  for (const entry of await readdir(configDir, { withFileTypes: true })) {
    const source = path.join(configDir, entry.name);
    await linkEntry(source, path.join(appDir, entry.name), entry.isDirectory());
  }
}

/** Removes `link` if it points into `root` at a path that does not exist. */
async function removeIfStale(link: string, root: string): Promise<void> {
  const source = await readlink(link);
  if (!source.startsWith(root + path.sep) || existsSync(source)) return;
  await rm(link);
  console.log(`herdr: removed ${link}, because ${source} does not exist`);
}

/**
 * Removes each link in `appDir` that points into `configDir` at a path that does not exist. Goes
 * only into the folders that also exist in `configDir`, because Herdr owns the other folders.
 */
async function removeStaleLinks(appDir: string, configDir: string, root: string): Promise<void> {
  for (const entry of await readdir(appDir, { withFileTypes: true })) {
    await removeStaleEntry(entry, appDir, configDir, root);
  }
}

async function removeStaleEntry(
  entry: Dirent,
  appDir: string,
  configDir: string,
  root: string,
): Promise<void> {
  const target = path.join(appDir, entry.name);
  const source = path.join(configDir, entry.name);
  if (entry.isSymbolicLink()) return removeIfStale(target, root);
  if (entry.isDirectory() && existsSync(source)) await removeStaleLinks(target, source, root);
}

/**
 * Links each file of `configDir` into `appDir`, at the same relative path. Herdr writes its own
 * files in the folders of `appDir`, so folders are made, not linked. A mod folder (a folder with
 * `mod.json`) is linked as one unit, and each run touches its link so that Herdr reloads it. Then removes each link into `configDir` whose source does
 * not exist, for example after a file in `configDir` is removed or renamed.
 */
export async function linkConfig(appDir: string, configDir: string = CONFIG_DIR): Promise<void> {
  await linkFolder(appDir, configDir);
  await removeStaleLinks(appDir, configDir, configDir);
}

async function main(): Promise<void> {
  const appDir = process.env["HERDR_APP_DIR"] ?? path.join(homedir(), ".config", "herdr-app");
  await linkConfig(appDir);
  console.log(`herdr: ${appDir} links the files in ${CONFIG_DIR}`);
}

if (import.meta.main) await main();
