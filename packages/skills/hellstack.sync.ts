import { join } from "node:path";
import { defineSync, skillEntries } from "@hellstack/sync";

/**
 * Copies each skill to the skill directories. Claude Code and opencode read skills from
 * `~/.claude/skills`, and pi reads them from `~/.pi/agent/skills`.
 */
export default defineSync(async ({ packageDir, roots }) => ({
  entries: await skillEntries(join(packageDir, "skills"), [
    join(roots.claude, "skills"),
    join(roots.pi, "skills"),
  ]),
}));
