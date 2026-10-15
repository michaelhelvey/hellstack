import { readdir, rm, stat, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** The home directory of the user. */
export const HOME = homedir();

/** The result of a command. */
export interface RunResult {
  code: number;
  stdout: string;
}

/** Runs a command and collects stdout. Gives code 127 when the command is not on `PATH`. */
export async function run(command: string[]): Promise<RunResult> {
  if (!Bun.which(command[0] ?? "")) return { code: 127, stdout: "" };

  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  return { code, stdout };
}

/** Runs a command with the output of the command on stderr. Throws when the command fails. */
export async function runLoud(command: string[]): Promise<void> {
  if (!Bun.which(command[0] ?? "")) throw new Error(`${command[0]} is not on PATH`);

  const proc = Bun.spawn(command, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;

  if (code !== 0) throw new Error(`${command.join(" ")} failed with exit code ${code}`);
}

/** Gives true when the path exists. */
export async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

/** Gives the modification time of the path in milliseconds, or undefined when it does not exist. */
export async function mtime(path: string): Promise<number | undefined> {
  return (await stat(path).catch(() => undefined))?.mtimeMs;
}

/** Gives the disk usage of the path in bytes with `du`. Gives 0 when the path does not exist. */
export async function diskUsage(path: string): Promise<number> {
  const { stdout } = await run(["du", "-sk", path]);
  const kilobytes = Number.parseInt(stdout, 10);

  return Number.isNaN(kilobytes) ? 0 : kilobytes * 1024;
}

/** Gives the sum of the disk usage of the paths in bytes. */
export async function totalDiskUsage(paths: string[]): Promise<number> {
  const sizes = await Promise.all(paths.map(diskUsage));

  return sizes.reduce((sum, size) => sum + size, 0);
}

/** Removes all the items in a directory, but keeps the directory. */
export async function emptyDirectory(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => []);

  await Promise.all(names.map((name) => rm(join(dir, name), { recursive: true, force: true })));
}

/** Gives the free space on the volume of the path in bytes. */
export async function freeSpace(path: string): Promise<number> {
  const info = await statfs(path);

  return info.bavail * info.bsize;
}

/** Applies `fn` to all items, with a maximum of `limit` calls at the same time. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;

      results[index] = await fn(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

/** Formats a number of bytes for humans, for example `1.4G`. */
export function formatBytes(bytes: number): string {
  const units = ["B", "K", "M", "G", "T"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)}${units[unit]}`;
}

/** Replaces the home directory at the start of the path with `~`. */
export function tildify(path: string): string {
  return path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}
