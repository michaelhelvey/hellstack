import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises";
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

async function linkEntry(source: string, target: string, isDir: boolean): Promise<void> {
  if (isDir && !existsSync(path.join(source, "mod.json"))) return linkConfig(target, source);
  await link(source, target);
}

/**
 * Links each file of `configDir` into `appDir`, at the same relative path. Herdr writes its own
 * files in the folders of `appDir`, so folders are made, not linked. A mod folder (a folder with
 * `mod.json`) is linked as one unit.
 */
export async function linkConfig(appDir: string, configDir: string = CONFIG_DIR): Promise<void> {
  if ((await lstat(appDir).catch(() => undefined))?.isSymbolicLink()) {
    throw new Error(`${appDir} is a link. Herdr owns this folder; make it a real folder.`);
  }
  await mkdir(appDir, { recursive: true });
  for (const entry of await readdir(configDir, { withFileTypes: true })) {
    const source = path.join(configDir, entry.name);
    await linkEntry(source, path.join(appDir, entry.name), entry.isDirectory());
  }
}

async function main(): Promise<void> {
  const appDir = process.env["HERDR_APP_DIR"] ?? path.join(homedir(), ".config", "herdr-app");
  await linkConfig(appDir);
  console.log(`herdr: ${appDir} links the files in ${CONFIG_DIR}`);
}

if (import.meta.main) await main();
