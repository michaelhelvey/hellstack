import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { factoryExtension } from "./extension/index.ts";

/** The factory extension for pi. It reads the role from `process.env`. */
export default function factory(pi: ExtensionAPI): void {
  factoryExtension(pi, process.env);
}
