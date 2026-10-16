import {
  type PatchSet,
  patchTree,
  removeLine,
  removeSection,
  replaceLine,
  replaceOnce,
  type Tree,
} from "@hellstack/pstack";

const readTheSource = `When you are working with a 3rd party library or tool, and that tool does not include the source in
the current working directory (e.g. the published NPM package contains only bundled code, the tool
is a CLI, etc), ask the \`librarian\` about its source first. When you must run or change the code,
clone it from the remote forge into \`~/thirdparty/<tool-name>\` in order to more fully understand it.`;

const sentryAuth = `### Authentication

In an Amp orb, the CLI is not installed and not authenticated. Install it with the command above.
Then, when \`sentry auth status\` fails, run \`sentry auth --token "$SENTRY_AUTH_TOKEN"\`. Amp sets
\`SENTRY_AUTH_TOKEN\` from the user's secrets. When it is not set, stop and tell the user to run
\`bun run amp:secrets\` in hellstack.`;

/**
 * The personal skills that Amp gets, and the changes for Amp. The paths are relative to the skill
 * directory of `@hellstack/skills`. The other skills need the user's machine: a desktop app, a
 * signed-in browser, a terminal multiplexer, or a VPN.
 */
export const personalSkillPatches: PatchSet = {
  include: [
    "jira",
    "pr",
    "principle-avoid-edge-cases",
    "principle-read-the-source",
    "review",
    "sentry-cli",
    "show-me",
    "tldraw",
    "whitespace",
  ],
  drop: [],
  overrides: {},
  edits: {
    "jira/SKILL.md": [removeLine('<a id="memory"></a>'), removeSection("## Memory")],
    "principle-read-the-source/SKILL.md": [
      replaceOnce(
        "When you are working with a 3rd party library or tool, and that tool does not include the source in\nthe current working directory (e.g. the published NPM package contains only bundled code, the tool\nis a CLI, etc), clone the code from the remote forge into `~/dev/thirdparty/<tool-name>` in order to\nmore fully understand it.",
        readTheSource,
      ),
      replaceOnce("present in `~/dev/thirdparty`", "present in `~/thirdparty`"),
    ],
    "review/references/angles.md": [
      replaceLine(
        "- User-level files that exist, for example `~/.claude/CLAUDE.md`",
        "- The user-level guidance in your instructions, and `~/.config/amp/AGENTS.md` when it exists.",
      ),
      removeLine("and `~/.pi/agent/AGENTS.md`."),
    ],
    "sentry-cli/SKILL.md": [
      replaceOnce(
        "### Authentication\n\n```bash\nsentry auth\nsentry auth --token YOUR_SENTRY_API_TOKEN\nsentry auth status\nsentry auth logout\n```",
        sentryAuth,
      ),
    ],
  },
  forbidden: [/memory\.md/, /JIRA_MEMORY_FILE/, /~\/dev\//, /~\/\.claude/, /~\/\.pi\//],
};

/**
 * Makes the personal skills for Amp from the skill directory of `@hellstack/skills`. The patch set
 * has no overrides, so the overrides directory is not read.
 */
export async function buildPersonalSkills(skillsDir: string): Promise<Tree> {
  return patchTree(skillsDir, personalSkillPatches, skillsDir);
}
