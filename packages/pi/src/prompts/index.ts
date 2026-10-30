import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readPrompt } from "@hellstack/prompts";

function readLocal(file: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
}

/** Returns the system prompt sections of hellstack, by name. */
export function promptSections(): Record<string, string> {
  return {
    instructions: [readPrompt("instructions"), readLocal("pi.md")].join("\n"),
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
