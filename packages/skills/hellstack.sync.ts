import { join } from "node:path";
import { defineSync, skillEntries } from "@hellstack/sync";

/**
 * Copies each skill to the skill directories. Claude Code reads skills from `~/.claude/skills`.
 * pi, opencode, Codex, and other agent tools read the shared `~/.agents/skills`.
 */
export default defineSync(async ({ packageDir, roots }) => ({
  entries: await skillEntries(join(packageDir, "skills"), [
    join(roots.claude, "skills"),
    join(roots.agents, "skills"),
  ]),
}));
