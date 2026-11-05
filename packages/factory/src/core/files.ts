import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Writes `text` to `path` atomically: it writes a temporary file, then renames it. */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, path);
}

/** Writes `text` to `path` only when `path` does not exist. Returns true when it wrote the file. */
export async function writeIfMissing(path: string, text: string): Promise<boolean> {
  try {
    await writeFile(path, text, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/** Reads `path` as UTF-8. Returns undefined when the file does not exist. */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function acquireLock(lock: string, attempts: number): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await writeIfMissing(lock, String(process.pid))) return;
    await delay(25);
  }
  await writeFile(lock, String(process.pid), "utf8");
}

/**
 * Runs `fn` while this process holds the lock file `<path>.lock`, so that read-change-write steps of
 * different processes do not mix. When the lock stays for about 5 seconds, it is stale and the
 * caller takes it.
 */
export async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  await mkdir(dirname(lock), { recursive: true });
  await acquireLock(lock, 200);
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/** Returns the `code` of a Node.js system error, or undefined. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}
