import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { type FileData, isCopied, listFiles, readFileData } from "./tree.ts";

/** One file or directory that the sync owns in a harness directory. */
export type Entry =
  | { kind: "file"; target: string; file: FileData }
  | { kind: "dir"; target: string; source: string };

/** Changes the text of a file before the sync writes it. */
export type Transform = (text: string) => string;

/** Makes a file entry that copies `source` to `target`. A transform changes the text first. */
export async function fileEntry(
  source: string,
  target: string,
  transform?: Transform,
): Promise<Entry> {
  const file = await readFileData(source);
  if (transform === undefined) return { kind: "file", target, file };
  const text = transform(new TextDecoder().decode(file.content));
  return { kind: "file", target, file: { ...file, content: new TextEncoder().encode(text) } };
}

/**
 * Makes one file entry for each file in a config directory. The config directory has the same
 * layout as the harness directory. A transform changes the file at its relative path.
 */
export async function configEntries(
  source: string,
  target: string,
  transforms: Record<string, Transform> = {},
): Promise<Entry[]> {
  const paths = await listFiles(source);
  return Promise.all(
    paths.map((path) => fileEntry(join(source, path), join(target, path), transforms[path])),
  );
}

/** Makes one directory entry for each skill, in each of the skill directories. */
export async function skillEntries(source: string, targets: string[]): Promise<Entry[]> {
  const dirents = await readdir(source, { withFileTypes: true });
  const names = dirents.filter((d) => d.isDirectory() && isCopied(d.name)).map((d) => d.name);
  return targets.flatMap((target) =>
    names.map((name): Entry => ({
      kind: "dir",
      target: join(target, name),
      source: join(source, name),
    })),
  );
}
