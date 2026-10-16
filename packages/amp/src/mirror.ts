import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Tree } from "./build.ts";
import { z } from "zod";

/**
 * The file in a checkout that lists the paths that hellstack wrote. A mirror removes only these
 * paths, so files that Amp or the user add to the repository stay.
 */
export const managedFileName = ".hellstack-managed.json";

const managedSchema = z.array(z.string());

async function readManaged(dir: string): Promise<string[]> {
  const text = await readFile(join(dir, managedFileName), "utf8").catch(() => undefined);
  return text === undefined ? [] : managedSchema.parse(JSON.parse(text));
}

/**
 * Makes the files of `dir` the same as `tree`. It removes the files that the last mirror wrote and
 * that are not in `tree`. It does not change other files.
 */
export async function mirror(dir: string, tree: Tree): Promise<void> {
  const stale = (await readManaged(dir)).filter((path) => !tree.has(path));
  await Promise.all(stale.map((path) => rm(join(dir, path), { force: true })));
  for (const [path, file] of tree) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
    await chmod(target, file.mode & 0o777);
  }
  const managed = `${JSON.stringify([...tree.keys()].sort(), null, 2)}\n`;
  await writeFile(join(dir, managedFileName), managed);
}
