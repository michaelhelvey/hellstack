import { join } from "node:path";
import type { PluginAPI } from "@ampcode/plugin";

export const description = "The chinchilla voice and pstack, in every mode.";

/** The instruction files that the first prompt of each thread gets, in order. */
export const instructionFiles = ["instructions.md", "chinchilla.md", "pstack.md", "pstack-amp.md"];

/** The text that each later prompt of a thread gets. */
export const reminder =
  "Keep the chinchilla voice and the pstack rules from the first message of this thread.";

/** Returns the text to add to a prompt. The first prompt of a thread gets all the instructions. */
export function promptText(started: Set<string>, threadId: string, instructions: string): string {
  const first = !started.has(threadId);
  started.add(threadId);
  return first ? instructions : reminder;
}

/**
 * Adds the chinchilla voice and pstack to the prompts of the user. Plugins cannot change the system
 * prompt of a built-in mode, so the first prompt of each thread gets the instructions as a hidden
 * message. It works in every mode.
 */
export default async function hellstack(amp: PluginAPI): Promise<void> {
  const files = instructionFiles.map((name) => Bun.file(join(import.meta.dir, name)).text());
  const instructions = (await Promise.all(files)).join("\n\n");
  const started = new Set<string>();
  amp.on("agent.start", (event) => ({
    message: { content: promptText(started, event.thread.id, instructions) },
  }));
}
