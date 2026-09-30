import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

/** File names that the sync does not copy, and does not use to compare directories. */
const ignoredNames = new Set(["node_modules", ".DS_Store"]);

/** A file with its content and its permission bits. */
export interface FileData {
  content: Uint8Array;
  mode: number;
}

/** Returns true when the sync copies the file or directory with this name. */
export function isCopied(name: string): boolean {
  return !ignoredNames.has(name);
}

/** Makes a hash of a file, from its content and its permission bits. */
export function hashFile(file: FileData): string {
  return createHash("sha256")
    .update(`file:${(file.mode & 0o777).toString(8)}:`)
    .update(file.content)
    .digest("hex");
}

async function statOrUndefined(path: string): Promise<Stats | undefined> {
  return lstat(path).catch(() => undefined);
}

/** Reads a regular file. */
export async function readFileData(path: string): Promise<FileData> {
  const [content, stats] = await Promise.all([readFile(path), lstat(path)]);
  return { content, mode: stats.mode };
}

/** Lists the paths of all copied files in a directory tree, relative to the directory, sorted. */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .filter((path) => path.split("/").every(isCopied))
    .sort();
}

async function hashDir(dir: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await listFiles(dir)) {
    hash.update(`${path}\0${await hashPath(join(dir, path))}\0`);
  }
  return `dir:${hash.digest("hex")}`;
}

/**
 * Makes a hash of the file, directory, or symbolic link at a path. Returns `undefined` when the
 * path does not exist. The sync does not follow symbolic links, so a link never has the same hash
 * as the file that it points to.
 */
export async function hashPath(path: string): Promise<string | undefined> {
  const stats = await statOrUndefined(path);
  if (stats === undefined) return undefined;
  if (stats.isSymbolicLink()) return `link:${await readlink(path)}`;
  if (stats.isDirectory()) return hashDir(path);
  return hashFile(await readFileData(path));
}

/** Removes a file, a directory tree, or a symbolic link. It does not follow symbolic links. */
export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** Writes a file. It removes a symbolic link or directory at the path first. */
export async function writeFileData(path: string, file: FileData): Promise<void> {
  await removePath(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content);
  await chmod(path, file.mode & 0o777);
}

/** Copies a file or directory tree without the ignored names. It replaces the target. */
export async function copyTree(source: string, target: string): Promise<void> {
  await removePath(target);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => isCopied(path.slice(path.lastIndexOf("/") + 1)),
  });
}
