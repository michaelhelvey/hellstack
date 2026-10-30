import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The prompt files of this package, in the order that a harness adds them. */
export const promptNames = ["instructions", "chinchilla"] as const;

/** The name of a prompt file of this package. */
export type PromptName = (typeof promptNames)[number];

/** Returns the path of a prompt file. */
export function promptPath(name: PromptName): string {
  return join(dirname(fileURLToPath(import.meta.url)), `${name}.md`);
}

/** Reads a prompt file. */
export function readPrompt(name: PromptName): string {
  return readFileSync(promptPath(name), "utf8");
}
