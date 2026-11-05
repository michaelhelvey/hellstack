import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

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

/** Returns the `code` of a Node.js system error, or undefined. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}
