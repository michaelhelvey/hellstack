import { join } from "node:path";

import { buildModule } from "../mods.ts";

/** Bundles the hooks module of the Mermaid mod, with `grok-mermaid` in it, to one ES module. */
export async function buildMermaidModule(): Promise<Uint8Array> {
  return buildModule(join(import.meta.dir, "register.ts"), "Mermaid");
}
