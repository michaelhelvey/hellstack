import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const layersFileSchema = z.object({ layers: z.array(z.string().min(1)) });

/** The names of the layers that are on for this machine, for example `t4`. */
export type Layers = ReadonlySet<string>;

/** Returns the path of the layers file in the hellstack config directory. */
export function layersPath(configDir: string): string {
  return join(configDir, "layers.json");
}

/** Parses a comma-separated list of layer names, for example `t4,herdr`. */
export function parseLayerList(value: string): Layers {
  return new Set(
    value
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
}

/**
 * Reads the layers of this machine from the layers file, for example `{ "layers": ["t4"] }`. The
 * file is not in the repository, because it is different on each machine. It throws an error when
 * the file does not exist, because a sync with the wrong layers can remove config.
 */
export async function readLayers(path: string): Promise<Layers> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) {
    throw new Error(
      `${path} does not exist. Write { "layers": [] } to it, or use --layers to set the layers.`,
    );
  }
  return new Set(layersFileSchema.parse(JSON.parse(text)).layers);
}
