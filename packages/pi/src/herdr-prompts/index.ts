import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Shows the herdr pane as blocked while pi waits for an answer to a dialog. The herdr pi extension
 * (from `herdr integration install pi`) sets the blocked state only on the `herdr:blocked` event, so
 * this extension sends that event for each pi `ui_prompt_start` and `ui_prompt_end` event.
 */
export default function herdrPrompts(pi: ExtensionAPI): void {
  pi.on("ui_prompt_start", (event) => {
    pi.events.emit("herdr:blocked", { active: true, label: event.title });
  });
  pi.on("ui_prompt_end", () => {
    pi.events.emit("herdr:blocked", { active: false });
  });
}
