## pstack in Amp

- Subagents: `Task` starts a subagent in this workspace. It cannot select a model. To run a subagent
  on a model of the pstack models sheet, or in its own checkout, use `create_thread` with the
  `agent_mode` of the sheet. Get the results with `wait_for_threads` and `read_thread`, and the
  files with `download_thread_changes`. A new thread does not see work that is not committed: push a
  branch, or send files with `upload_thread_file`. Steer a thread with `send_thread_message`.
- Ask the user: `ask_user_choice`. When nobody watches the thread, ask in plain text.
- Wakeups: `set_schedule` on this thread.
- Todolist: keep a `todo.md` checklist in the work directory.
- Session history: Amp threads. `find_thread` searches them and `read_thread` reads one. In an orb,
  `$AMP_THREAD_ID` is this thread.
- Watch a PR: do not poll. Call `create_github_subscription` with `filter_kind: "pr-comments"`, and
  with `filter_kind: "ci"` for the head commit. Subscribe again after each push.
- Some tools are deferred. Find them with `tool_search` and call them with `code_exec` before you
  decide that Amp does not have a tool.
- Amp does not keep the executable bit of skill files. Run `chmod +x` on the scripts of a skill
  before you run one.
- A browser in an orb: run `amp orb desktop ensure`, and connect `agent-browser --cdp` to the
  endpoint that it prints.

## pstack models

Each value is an `agent_mode` for `create_thread`, or `oracle` for the `oracle` tool. The modes use
the models that the user set in Tune Modes. A panel gets one thread for each value.

- strongest judgment: oracle
- feature, refactoring, bug-fix, perf-issue, hillclimb: high
- judgment and prose, how explainer, why synthesizer: high
- reflect judgment, divergent, synthesizer: high
- reflect tooling, how explorer, why investigators, swarm workers: medium
- arena runners, architect runners, interrogate reviewers: high, ultra, medium
- arena cross-judge pool: ultra, high
