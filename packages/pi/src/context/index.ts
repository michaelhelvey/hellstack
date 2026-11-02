import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { renderContextText } from "./render.ts";
import { buildContextReport } from "./report.ts";
import { readSnapshot } from "./snapshot.ts";
import { ContextOverlay } from "./ui.ts";

async function showContext(ctx: ExtensionCommandContext): Promise<void> {
  const report = buildContextReport(readSnapshot(ctx));

  if (ctx.mode === "tui") {
    await ctx.ui.custom<void>(
      (tui, theme, keybindings, done) =>
        new ContextOverlay({ tui, theme, keybindings, report, done }),
      { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center" } },
    );
    return;
  }

  const text = renderContextText(report).join("\n");
  if (ctx.hasUI) ctx.ui.notify(text, "info");
  else console.log(text);
}

/**
 * Adds the `/context` command. It shows the token counts and the sources of the current context
 * window: the system prompt sections, the tool declarations, the conversation, and the largest
 * single messages.
 */
export default function context(pi: ExtensionAPI): void {
  pi.registerCommand("context", {
    description: "Show where the context window goes: token counts and sources",
    handler: async (_args, ctx) => showContext(ctx),
  });
}
