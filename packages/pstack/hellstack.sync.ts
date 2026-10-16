import { join } from "node:path";
import { defineSync, type Entry, type FileData } from "@hellstack/sync";

import { buildPstack, pstackTarget } from "./src/index.ts";

/** The pstack skills that the sync also copies to the Claude Code skill directory. */
export const claudeSkills = ["create-verification-skill", "maintain-verification-skill"];

function fileEntry(target: string, file: FileData): Entry {
  return { kind: "file", target, file };
}

function claudeSkillPath(path: string): string | undefined {
  const name = claudeSkills.find((skill) => path.startsWith(`skills/${skill}/`));
  return name === undefined ? undefined : path.slice("skills/".length);
}

/**
 * Writes the patched pstack pi package to `~/.pi/agent/vendor/pstack`. The sync of `@hellstack/pi`
 * adds that directory to `packages` in `settings.json`. It also copies `claudeSkills` to
 * `~/.claude/skills`.
 */
export default defineSync(async ({ packageDir, roots }) => {
  const target = pstackTarget(roots);
  const tree = [...(await buildPstack(packageDir))];
  const pi = tree.map(([path, file]) => fileEntry(join(target, path), file));
  const claude = tree.flatMap(([path, file]) => {
    const skillPath = claudeSkillPath(path);
    return skillPath === undefined
      ? []
      : [fileEntry(join(roots.claude, "skills", skillPath), file)];
  });
  return { entries: [...pi, ...claude] };
});
