import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Returns the folder of the skill `name` in this package. */
export function skillDir(name: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "skills", name);
}
