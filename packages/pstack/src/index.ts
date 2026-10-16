import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Roots } from "@hellstack/sync";
import { z } from "zod";

import { patchTree, type Tree } from "./patch.ts";
import { pstackPatches } from "./patches.ts";

export {
  type Edit,
  type Override,
  type PatchSet,
  patchTree,
  removeLine,
  replaceOnce,
  replaceSection,
  type Tree,
  upstreamHash,
} from "./patch.ts";
export { pstackPatches } from "./patches.ts";

/** The path of the pstack submodule, relative to this package. */
export const vendorPath = join("vendor", "pstack-claude");

const upstreamPackage = z.object({ version: z.string() });

/** Returns the directory that the sync writes the patched pstack pi package to. */
export function pstackTarget(roots: Roots): string {
  return join(roots.pi, "vendor", "pstack");
}

async function readVersion(vendorDir: string): Promise<string> {
  const text = await readFile(join(vendorDir, "package.json"), "utf8").catch(() => {
    throw new Error(`${vendorDir} is empty. Run: git submodule update --init`);
  });
  return upstreamPackage.parse(JSON.parse(text)).version;
}

function packageJson(version: string): Uint8Array {
  const data = {
    name: "pstack",
    version,
    private: true,
    description: "pstack, patched by hellstack. Do not edit: `bun run sync` writes this directory.",
    keywords: ["pi-package"],
    pi: { skills: ["./skills"], extensions: ["./pi/index.ts"] },
  };
  return new TextEncoder().encode(`${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Makes the patched pstack pi package from the submodule in `packageDir`. It throws an error when
 * a patch does not apply.
 */
export async function buildPstack(packageDir: string): Promise<Tree> {
  const vendorDir = join(packageDir, vendorPath);
  const version = await readVersion(vendorDir);
  const pluginDir = join(vendorDir, "plugins", "pstack");
  const tree = await patchTree(pluginDir, pstackPatches, join(packageDir, "overrides"));
  tree.set("package.json", { content: packageJson(version), mode: 0o644 });
  return tree;
}
