import { join } from "node:path";

import { buildModule } from "../mods.ts";

/** Bundles the hooks module of the spinner mod to one ES module. */
export async function buildSpinnerModule(): Promise<Uint8Array> {
  return buildModule(join(import.meta.dir, "register.ts"), "spinner");
}
