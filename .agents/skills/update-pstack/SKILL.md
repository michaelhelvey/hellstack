---
name: update-pstack
description:
  Ports upstream changes to pstack, thermos, and the cursor-team-kit skills from cursor/plugins into
  packages/skills, in the hellstack house style. Use when the user asks to update, sync, or pull
  pstack, or when a scheduled run asks for it.
---

# Update pstack

hellstack owns its copy of pstack. The skills in `packages/skills/upstream.json` came from
[cursor/plugins](https://github.com/cursor/plugins) and were rewritten in the house style below, so
that they work in pi and Amp with no translation layer. There is no patch set. You port each
upstream change by hand.

## Steps

1. Run `bun run pstack diff > /tmp/pstack.diff`. It shows the upstream diff since the commit in
   `upstream.json`, and the new upstream paths that no skill tracks. If there are no changes, stop
   and tell the user that pstack is current.
2. Port each hunk. Find the same text in our copy and make the same change in the house style. When
   the upstream text is not in our copy because the house style removed it, skip the hunk.
3. For each new upstream path, take it with `bun run pstack add <skill> <path...>` and rewrite it in
   the house style, or add the path to `skipped` in `upstream.json` when it cannot work in pi or
   Amp. When upstream removed a skill, remove our copy and its entry.
4. Run `bun run pstack bump`.
5. Run `bun test packages/skills/tests packages/amp/tests`. The house-style test fails on Cursor and
   Claude Code words, broken links, and bad skill names. The Amp test fails when a skill names a
   pstack models role that `packages/amp/plugin/hellstack/amp.md` does not have.
6. Report the old and new commits, the hunks that you skipped and why, and the new or removed
   skills. Do not commit or publish unless the user asked for it.

## House style

The skills name capabilities, not tools. The system prompt of each harness has a `pstack` section
that tells the model its tools, its session history, and the **pstack models** sheet. A skill does
not repeat that information.

Change only what the house style needs. Keep the upstream words everywhere else, so that the next
diff ports cleanly.

| Upstream                                                                       | House style                                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `Task` call, `subagent_type`, `generalPurpose`, `is_background`              | "Start a subagent". Remove the field.                                                                                                            |
| `run_in_background: true`                                                      | Remove it. Subagents run in parallel.                                                                                                            |
| `readonly: true`                                                               | "Tell the subagent not to change files."                                                                                                         |
| `environment: "cloud"`, a cloud agent                                          | "A subagent in its own git worktree."                                                                                                            |
| `subagent_type: "poteto-agent"`                                                | "A poteto-agent subagent". poteto-mode says what its brief contains.                                                                             |
| A pstack agent file in `agents/`                                               | Keep the file in the skill that uses it. The brief tells the subagent to read the file by its absolute path.                                     |
| `AskQuestion`                                                                  | "Ask the user".                                                                                                                                  |
| A model slug (`claude-opus-5-5-xhigh`, `grok-4.7-xhigh-fast`), a default model | "The `<role>` line of the pstack models sheet." Do not name a default model. Without the line, the subagent runs on the session model.           |
| `pstack-models.mdc`, `/setup-pstack`, budgets, reasoning levels, fast mode     | "The pstack models sheet". Remove the text about levels and speed.                                                                               |
| `/loop`, `/loop 1h`                                                            | "A wakeup", "a wakeup every hour".                                                                                                               |
| Agent transcripts, `~/.cursor/projects/`, a chat UUID                          | "Your session history", "a session".                                                                                                             |
| Bugbot                                                                         | "A review bot".                                                                                                                                  |
| `cursor-team-kit` skills                                                       | The skill by name, for example the **deslop** skill. hellstack has `deslop`, `control-cli`, and `control-ui`.                                    |
| The `create-skill` skill                                                       | The **Authoring or modifying a skill** playbook of poteto-mode.                                                                                  |
| `.cursor/skills/`, `~/.cursor/skills/`, `.cursor/rules/*.mdc`                  | `.agents/skills/`, `~/.agents/skills/`, `AGENTS.md`.                                                                                             |
| The `no-comments` skill, the `comment-sicko` agent                             | The Comments section of poteto-mode.                                                                                                             |
| Cursor features (automations, canvases, the Cursor PR tool, Custom Modes)      | Remove the step, or use the general form (for example `gh`).                                                                                     |
| Claude Code words (`Agent` tool, `AskUserQuestion`, `~/.claude`, `CLAUDE.md`)  | The same rules. An instructions file is `AGENTS.md`.                                                                                             |
| Frontmatter                                                                    | `name` is the directory name. Remove `icon` and `color`. poteto-mode has no `disable-model-invocation`, because the pstack section routes to it. |
