import { type PatchSet, removeLine, replaceLine, replaceOnce, replaceSection } from "./patch.ts";
import { commentDrops, commentEdits, commentForbidden } from "./patches.ts";

const platformAdaptation = `
These skills use Claude Code tool names (the \`Skill\` tool, the \`Agent\` tool, \`AskUserQuestion\`) and Claude model names. You run on Amp. Read [\`references/amp-tools.md\`](references/amp-tools.md) for the Amp equivalent of each tool, model, and skill that these workflows name.

Amp has no task-tracking tool. Keep an uncommitted \`todo.md\` Markdown checklist in the work dir, next to the decision trail, with the playbook steps verbatim and each \`skip: <reason>\` line. When several sessions share the checkout, name it \`.audit/<task-slug>.todo.md\`, beside that session's \`.audit/<task-slug>.tsv\` trail, so they never write one file.
`;

const recallHistory =
  "Your chat history is your Amp threads. Search them with `find_thread` and read one with `read_thread`. Search only the threads of the active project unless the user asks for more.";

const recallFanOut =
  "3. Fan out across your chat history. Search with `find_thread` for the topic and the time window, newest first. Skip the current thread (`$AMP_THREAD_ID`) and obvious noise (subagent, eval, and test threads). For more than two threads, give each `Task` subagent a slice of the thread IDs and tell it to read them with `read_thread`. Each returns the same schema, one block per thread: topic, the user's goal, decisions, open threads, struggles and corrections, and artifacts (PRs, tickets, branches), each citing the thread ID. For one or two threads, read them directly. The raw threads stay in the subagents. The main thread gets only their findings.";

const reflectTranscript = `
The active transcript is this Amp thread. In an orb, its ID is \`$AMP_THREAD_ID\`. Give each reviewer the thread ID in place of a transcript path, and tell it to read the thread with \`read_thread\`.

If a reviewer cannot read the thread, write a tight digest of the session and pass that instead. It lists, one line each in turn order, the user's prompts and corrections, the tool calls and their results, and the files touched. It states no diagnosis, verdict, or cause. The reviewers judge the session, not your conclusions about it.
`;

const pickupTrail =
  "1. Find the prior trail: an Amp thread URL or ID, or a pushed branch. Read the thread with `read_thread`, and get its uncommitted work with `download_thread_changes`. When you do not know the thread, search for it with `find_thread` in the active project. Read the last messages first, then scan back for the decision points. Parse a long thread in a `Task` subagent and keep the reduced timeline in the main thread (the **principle-guard-the-context-window** skill).";

const babysitPlaybookPacing =
  "On Amp, do not poll and do not loop. For `drive` and `background`, subscribe this thread to the PR's comments and reviews, and to CI for its exact head commit, with Amp's GitHub subscriptions. The events continue this thread. After every push wave, subscribe to CI for the new head commit. Run the watcher only with `--status-only`, for one status read.";

const babysitLoop = `3. **Loop.** Use the Claude Code \`loop\` skill to pace re-checks. Pick the interval from what you're watching:
   - Active CI run: poll \`gh pr checks --watch\` (it blocks until checks finish, so no separate loop interval needed).
   - Awaiting reviewer: 20–30 min heartbeat.
   - Idle but want to catch new comments: hourly.`;

const babysitEvents =
  "3. **Wait for events.** Do not poll. Subscribe this thread to the PR's comments and reviews, and to CI for its exact head commit, with Amp's GitHub subscriptions. The events continue this thread. After each push, subscribe to CI for the new head commit. To check on a reviewer who does not answer, ask Amp to schedule a check on this thread.";

/**
 * The changes that hellstack makes to the pstack plugin for Amp. The paths are relative to
 * `plugins/pstack` in the upstream repository.
 *
 * - Amp loads only the skills. `amp-tools.md` maps the Claude Code tools to the Amp tools.
 * - Amp threads replace the local transcripts, and Amp's GitHub subscriptions replace the PR
 *   polling loops.
 * - The skills and files for local machines and for other runtimes are not in the tree.
 * - The comment rule of hellstack replaces `no-comments` and the comment rule of poteto-mode.
 */
export const ampPatches: PatchSet = {
  include: [
    "agents/poteto-agent.md",
    "agents/thermo-nuclear-code-quality-review-subagent.md",
    "agents/thermo-nuclear-review-subagent.md",
    "skills",
  ],
  drop: [
    ...commentDrops,
    "skills/automate-me",
    "skills/poteto-help",
    "skills/setup-pstack",
    "skills/poteto-mode/playbooks/pause-safely.md",
    "skills/poteto-mode/playbooks/worktree-cleanup.md",
    "skills/poteto-mode/references/codex-tools.md",
    "skills/poteto-mode/references/copilot-tools.md",
    "skills/poteto-mode/references/pi-tools.md",
    "skills/poteto-mode/references/resume-storage.md",
    "skills/poteto-mode/scripts/resume.mjs",
    "skills/poteto-mode/scripts/worktree-audit.mjs",
    "skills/reflect/scripts",
  ],
  overrides: {
    "skills/poteto-mode/references/amp-tools.md": { upstream: null },
  },
  dropLines: [
    /^On Codex, read the \[platform mapping\]/,
    /^On GitHub Copilot, read the \[platform mapping\]/,
  ],
  edits: {
    ...commentEdits,
    "skills/poteto-mode/SKILL.md": [
      ...(commentEdits["skills/poteto-mode/SKILL.md"] ?? []),
      replaceSection("## Platform Adaptation", platformAdaptation),
      removeLine("- **Pause safely.**"),
      removeLine("- **Worktree and simulator cleanup.**"),
    ],
    "skills/poteto-mode/playbooks/session-pickup.md": [
      replaceLine("1. Read the project checkpoint first", pickupTrail),
    ],
    "skills/poteto-mode/playbooks/babysit.md": [
      replaceOnce(
        "Run `drive` and `background` under `/loop` in dynamic mode. Rearm the watcher after every push wave and every verdict you act on. Watcher output drives wakeups. Never add a second sleep loop.",
        babysitPlaybookPacing,
      ),
    ],
    "skills/babysit/SKILL.md": [
      replaceLine(
        "The implementation is a loop over `gh` CLI",
        "The implementation is `gh` plus Amp's GitHub subscriptions for pacing.",
      ),
      replaceOnce(babysitLoop, babysitEvents),
    ],
    "skills/recall/SKILL.md": [
      replaceOnce(" Turning habits into a durable skill is `automate-me`.", ""),
      replaceLine("Transcripts live at `~/.claude/projects/", recallHistory),
      replaceLine("3. Fan out across your chat history.", recallFanOut),
    ],
    "skills/reflect/SKILL.md": [
      replaceSection("## 1. Locate the active transcript", reflectTranscript),
    ],
  },
  forbidden: [
    ...commentForbidden,
    /automate-me/,
    /find-transcript/,
    /resume\.mjs/,
    /worktree-audit/,
  ],
};
