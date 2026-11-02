import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The path of the global `AGENTS.md`. Pi loads this file as a context file in every session, from
 * the agent folder. `bun run sync` makes the link in the agent folder.
 */
export const AGENTS_FILE = join(dirname(fileURLToPath(import.meta.url)), "AGENTS.md");
