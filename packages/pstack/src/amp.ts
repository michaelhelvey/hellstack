import { join } from "node:path";

import { patchTree, type Tree } from "./patch.ts";
import { ampPatches } from "./amp-patches.ts";

/** The directory of the Amp overrides, relative to this package. */
export const ampOverridesPath = "amp-overrides";

/** The upstream agent definitions. The Amp tree keeps them in the poteto-mode references. */
const agentsDir = "agents/";
const ampAgentsDir = "poteto-mode/references/agents/";

function ampPath(path: string): string {
  if (path.startsWith(agentsDir)) return ampAgentsDir + path.slice(agentsDir.length);
  return path.slice("skills/".length);
}

/**
 * Makes the patched pstack skills for the Amp personal skills repository from the submodule in
 * `packageDir`. Each path is relative to the root of that repository, so each skill is a top-level
 * directory. It throws an error when a patch does not apply.
 */
export async function buildAmpPstack(packageDir: string): Promise<Tree> {
  const pluginDir = join(packageDir, "vendor", "pstack-claude", "plugins", "pstack");
  const tree = await patchTree(pluginDir, ampPatches, join(packageDir, ampOverridesPath));
  return new Map([...tree].map(([path, file]) => [ampPath(path), file]));
}
