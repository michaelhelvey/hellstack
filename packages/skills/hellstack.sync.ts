import { join } from "node:path";
import { defineSync, skillEntries } from "@hellstack/sync";

/**
 * Copies each skill to the skill directories. Claude Code reads skills from `~/.claude/skills`,
 * pi reads them from `~/.pi/agent/skills`, and opencode, Codex, and other tools read the shared
 * `~/.agents/skills`.
 */
export default defineSync(async ({ packageDir, roots }) => ({
  entries: await skillEntries(join(packageDir, "skills"), [
    join(roots.claude, "skills"),
    join(roots.pi, "skills"),
    join(roots.agents, "skills"),
  ]),
}));
