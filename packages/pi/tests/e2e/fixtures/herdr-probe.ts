import { appendFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * A test extension. It writes each `herdr:blocked` event as one JSON line to the file in
 * `E2E_PROBE_FILE`, and adds the `/probe-confirm` command, which shows a confirm dialog.
 */
export default function herdrProbe(pi: ExtensionAPI): void {
  const file = process.env["E2E_PROBE_FILE"] ?? "";
  pi.events.on("herdr:blocked", (data) => {
    appendFileSync(file, `${JSON.stringify(data)}\n`);
  });
  pi.registerCommand("probe-confirm", {
    description: "Show a confirm dialog",
    handler: async (_args, ctx) => {
      await ctx.ui.confirm("Probe dialog", "Continue?");
    },
  });
}
