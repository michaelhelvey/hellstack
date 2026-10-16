## pstack in pi

- Subagents: `subagent_start` starts a pi subagent in a herdr pane. Give `model` as
  `provider/model`, from the pstack models sheet. A subagent does not get the subagent tools, so it
  cannot start its own subagents: do that fan-out yourself, or tell the subagent to work in
  sequence. Subagents share your checkout. Give each subagent that writes its own git worktree. When
  pi does not run in herdr, there are no subagents: do the work in sequence, and say so.
- Ask the user: `ask_user_question`.
- Wakeups: `schedule_wakeup`. The user starts a loop with `/loop [interval] <prompt>`.
- Todolist: `todo`.
- Session history: `~/.pi/agent/sessions/--<cwd>--/*.jsonl`, where `<cwd>` is the working directory
  without its first `/` and with each `/` changed to `-`. Each line is a JSON entry. A message entry
  has `type: "message"` and `message.role`. A file keeps abandoned branches, so follow `parentId`
  back from the last entry. Read only the directory of this workspace.
- Watch a PR: run the `watch-pr` script of poteto-mode, then schedule a wakeup to run it again.

## pstack models
