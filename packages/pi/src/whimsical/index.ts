import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { WORKING_MESSAGES } from "./messages.ts";

function pickRandomMessage(): string | undefined {
  return WORKING_MESSAGES[Math.floor(Math.random() * WORKING_MESSAGES.length)];
}

/** Shows a random working message at the start of each turn. */
export default function whimsical(pi: ExtensionAPI): void {
  pi.on("turn_start", (_event, ctx) => {
    ctx.ui.setWorkingMessage(pickRandomMessage());
  });

  pi.on("turn_end", (_event, ctx) => {
    ctx.ui.setWorkingMessage();
  });
}
