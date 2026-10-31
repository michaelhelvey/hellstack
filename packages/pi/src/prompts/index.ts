import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readPrompt } from "@hellstack/prompts";

/**
 * The pi notes. This path is the same from `src/prompts` and from `dist/prompts`, because both
 * folders are two levels below the package folder.
 */
const PI_NOTES = new URL("../../src/prompts/pi.md", import.meta.url);

/** Returns the system prompt sections of hellstack, by name. */
export function promptSections(): Record<string, string> {
  return {
    instructions: [readPrompt("instructions"), readFileSync(PI_NOTES, "utf8")].join("\n"),
    chinchilla: readPrompt("chinchilla"),
  };
}

/**
 * Adds the global instructions and the chinchilla voice to the system prompt. It sets them again at
 * each agent start, so that compaction does not remove them.
 */
export default function prompts(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    Object.assign(event.systemPromptOptions.sections, promptSections());
  });
}
