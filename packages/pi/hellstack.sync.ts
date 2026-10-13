import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import {
  appendJsonValues,
  configEntries,
  defineSync,
  type Layers,
  setJsonValue,
} from "@hellstack/sync";

/** The pi packages that the `t4` layer adds to `settings.json`. */
export const t4Packages = ["npm:@transport4/aig-plugin-pi", "npm:pi-claude-bridge"];

/**
 * The model settings that each machine keeps. The sync copies them from the current
 * `settings.json` and does not set them from this repository.
 */
const machineModelSettings = z
  .object({
    defaultProvider: z.unknown(),
    defaultModel: z.unknown(),
    defaultThinkingLevel: z.unknown(),
    enabledModels: z.unknown(),
  })
  .partial();

/** The data that `piSettings` uses to change `settings.json`. */
export interface PiSettingsOptions {
  layers: Layers;
  packageDir: string;
  /** The text of the current `settings.json` on this machine, if it exists. */
  current?: string | undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function keepModelSettings(text: string, current: string | undefined): string {
  if (current === undefined) return text;
  const parsed = machineModelSettings.safeParse(parseJson(current));
  if (!parsed.success) return text;
  return Object.entries(parsed.data)
    .filter(([, value]) => value !== undefined)
    .reduce((next, [key, value]) => setJsonValue(next, [key], value), text);
}

/**
 * Changes the text of `settings.json` for the layers. Pi does not load packages from the agent
 * directory, so it also adds this package to `packages`. It keeps the model settings of the
 * current file.
 */
export function piSettings(text: string, options: PiSettingsOptions): string {
  const layered = options.layers.has("t4")
    ? appendJsonValues(text, ["packages"], t4Packages)
    : text;
  const withPackage = appendJsonValues(layered, ["packages"], [options.packageDir]);
  return keepModelSettings(withPackage, options.current);
}

async function readCurrent(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

/** Copies `agent/` to the pi agent directory, and installs the herdr integration. */
export default defineSync(async ({ packageDir, roots, layers }) => {
  const current = await readCurrent(join(roots.pi, "settings.json"));
  return {
    entries: await configEntries(join(packageDir, "agent"), roots.pi, {
      "settings.json": (text) => piSettings(text, { layers, packageDir, current }),
    }),
    integrations: [{ name: "herdr (pi)", command: ["herdr", "integration", "install", "pi"] }],
  };
});
