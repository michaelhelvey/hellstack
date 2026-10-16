import { type PatchSet, removeLine, replaceOnce, replaceSection } from "./patch.ts";

/** The comment rule of hellstack. It replaces the Comments section of poteto-mode. */
const commentRule = `
Write comments clean as you go. Give each public export of a module a doc comment. Do not write other comments. Write one only when the code would look wrong to a reader without it, for example a lint ignore. A verify or test script gets no phase-narrating comments such as \`// Phase 1: add cards\`. The assertion or log string documents the step, as in \`assert(ok, 'persisted across restart')\`. This applies to every file you produce, including the delegate's diff.
`;

/**
 * The changes that hellstack makes to the pstack plugin. The paths are relative to
 * `plugins/pstack` in the upstream repository.
 *
 * - The herdr-agents extension of `@hellstack/pi` supplies the subagents, so the package does not
 *   have the pstack agent runner. `pi-tools.md` maps the pstack subagent words to the `subagent_*`
 *   tools.
 * - The comment rule of hellstack replaces `no-comments` and the comment rule of poteto-mode.
 */
export const pstackPatches: PatchSet = {
  include: [
    "agents",
    "hooks/session-start-context.md",
    "models.json",
    "pi/ask.ts",
    "pi/config.ts",
    "pi/index.ts",
    "pi/one-shot.ts",
    "pi/path-skills.ts",
    "pi/prompt.ts",
    "pi/schedule.ts",
    "skills",
  ],
  drop: [
    "agents/comment-sicko.md",
    "skills/no-comments",
    "skills/poteto-mode/references/agents/comment-sicko.md",
  ],
  overrides: {
    "pi/index.ts": { upstream: "e46ae2b8136beef4" },
    "skills/poteto-mode/references/pi-tools.md": { upstream: "10d29b6109722b00" },
  },
  edits: {
    "skills/poteto-mode/SKILL.md": [
      removeLine("- Before review → the **no-comments** skill"),
      replaceSection("## Comments", commentRule),
    ],
    "skills/poteto-help/SKILL.md": [removeLine("[`/no-comments`]")],
    "skills/poteto-mode/playbooks/multi-phase-plan.md": [
      replaceOnce(
        "Run `/deslop` before each commit and `/no-comments` before review.",
        "Run `/deslop` before each commit.",
      ),
    ],
    "skills/poteto-mode/playbooks/autopilot-full.md": [
      replaceOnce(" and the `/no-comments` pass, so the full swarm", ", so the full swarm"),
    ],
    "skills/poteto-mode/playbooks/opening-a-pr.md": [
      replaceOnce(
        "Run `/deslop` over the diff before commit and `/no-comments` before review.",
        "Run `/deslop` over the diff before commit.",
      ),
      replaceOnce(
        "runs `interrogate`, `/deslop`, and `/no-comments`,",
        "runs `interrogate` and `/deslop`,",
      ),
    ],
    "skills/poteto-mode/references/licenses/NOTICE.md": [
      replaceOnce(
        "principles, scripts, and the `comment-sicko` definition",
        "principles, and scripts",
      ),
    ],
    "skills/poteto-mode/references/codex-tools.md": [
      removeLine("There is no `comment-sicko` subagent type either."),
      removeLine("| `no-comments` |"),
    ],
    "skills/poteto-mode/references/copilot-tools.md": [
      replaceOnce("`pstack:poteto-agent`, `pstack:comment-sicko`,", "`pstack:poteto-agent`,"),
      removeLine("| `no-comments` |"),
    ],
  },
  forbidden: [/no-comments/i, /comment[ -]sicko/i],
};
