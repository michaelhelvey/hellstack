import { join } from "node:path";

import { buildModule } from "../mods.ts";

/** Bundles the hooks module of the quick-quote mod, with `marked` in it, to one ES module. */
export async function buildQuickQuoteModule(): Promise<Uint8Array> {
  return buildModule(join(import.meta.dir, "register.ts"), "quick-quote");
}
