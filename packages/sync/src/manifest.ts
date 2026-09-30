import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const manifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.string()),
});

/** The targets that the last sync wrote, with the hash of each target after that sync. */
export type Manifest = Record<string, string>;

/** Reads the manifest. Returns an empty manifest when the file does not exist. */
export async function readManifest(path: string): Promise<Manifest> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return {};
  return manifestSchema.parse(JSON.parse(text)).entries;
}

/** Writes the manifest. */
export async function writeManifest(path: string, entries: Manifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
}
