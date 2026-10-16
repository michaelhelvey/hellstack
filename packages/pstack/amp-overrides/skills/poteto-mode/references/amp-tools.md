# Amp tool mapping for pstack

pstack skills use Claude Code tool words (the `Skill` tool, the `Agent` tool, `AskUserQuestion`,
Claude model names). On Amp, the skills are the same files, loaded from the personal skills
repository. Read this file when a pstack skill names a Claude tool, a bundled skill, a model, or a
Claude Code path. This file is Amp-specific.

An Amp thread usually runs in an orb: a remote Linux machine with a checkout of the project. Puck
has no orb. Puck can read the skills, but it cannot run their scripts. For work that needs a script,
Puck starts an agent in an orb.

## Tool actions

Some Amp tools are deferred: they are not in your tool list, but you can find them with
`tool_search` and call them with `code_exec`. `find_thread`, `send_thread_message`,
`get_thread_status`, `set_schedule`, `get_schedule`, and `create_github_subscription` are usually
deferred. Search for a tool before you decide that Amp does not have it.

| pstack / Claude action                                                      | Amp equivalent                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read a file                                                                 | The read tool of the mode when it has one, otherwise `shell_command` (`cat`, `sed -n`)                                                                                                                                                                                              |
| Create a file                                                               | `create_file`                                                                                                                                                                                                                                                                       |
| Edit a file                                                                 | `edit_file` or `apply_patch`, whichever the mode has                                                                                                                                                                                                                                |
| Run a shell command                                                         | `shell_command`. For a long command, use its background mode with `shell_command_status`.                                                                                                                                                                                           |
| Search the code                                                             | `finder` for a question about the code, or `shell_command` with `rg`                                                                                                                                                                                                                |
| Read code in another repository                                             | `librarian`                                                                                                                                                                                                                                                                         |
| Fetch a URL                                                                 | `read_web_page`                                                                                                                                                                                                                                                                     |
| Search the web                                                              | `web_search`                                                                                                                                                                                                                                                                        |
| Look at an image or a video                                                 | `view_media`                                                                                                                                                                                                                                                                        |
| Invoke a skill (the `Skill` tool, `/command`)                               | `skill`                                                                                                                                                                                                                                                                             |
| Dispatch a subagent (the `Agent` tool) without a model                      | `Task`. It works in this workspace, has its own context window, and returns its final summary. Several `Task` calls in one response run in parallel.                                                                                                                                |
| Dispatch a subagent with a model, or a multi-model panel                    | `create_thread` with an `agent_mode` from [Model names](#model-names). Each thread is a new orb with its own checkout. Use `wait_for_threads` for the results, `read_thread` for the full reply, and `download_thread_changes` or `download_thread_file` for its files.             |
| `isolation: "worktree"`                                                     | `create_thread`, because each thread has its own checkout. For a `Task` that writes, make a git worktree yourself and put its absolute path in the task.                                                                                                                            |
| Continue or steer a subagent (`SendMessage`)                                | `send_thread_message` to a thread from `create_thread`. A `Task` cannot be continued. Give the next work to a fresh `Task`.                                                                                                                                                         |
| Check on a subagent                                                         | `get_thread_status`                                                                                                                                                                                                                                                                 |
| Stop a subagent                                                             | `send_thread_message` that tells the thread to stop.                                                                                                                                                                                                                                |
| The "strongest judgment" role, or a second opinion                          | `oracle`                                                                                                                                                                                                                                                                            |
| Ask the human a fixed-choice question (`AskUserQuestion`)                   | `ask_user_choice`. When nobody watches the thread, for example in a scheduled run, ask in plain text.                                                                                                                                                                               |
| Track tasks (`TaskCreate`, `TodoWrite`)                                     | Amp has no task-tracking tool. Keep the `todo.md` checklist that poteto-mode describes.                                                                                                                                                                                             |
| Schedule a re-invocation (`ScheduleWakeup`, `/loop`)                        | `set_schedule` on this thread, with the time and the prompt to run then. A thread has one schedule. `get_schedule`, `update_schedule`, and `clear_schedule` manage it.                                                                                                              |
| Poll a PR, its review threads, or its CI                                    | Do not poll. Call `create_github_subscription` two times: with `filter_kind: "pr-comments"` for the PR's comments and reviews, and with `filter_kind: "ci"` for CI on its exact head commit. The events continue the thread. After a push, subscribe to CI for the new head commit. |
| Read session transcripts (`~/.claude/projects/<encoded-cwd>/`, a chat UUID) | Amp threads. `find_thread` searches them and `read_thread` reads one. A thread ID (`T-...`) takes the place of a chat UUID. In an orb, `$AMP_THREAD_ID` is the current thread.                                                                                                      |
| Hand work to an agent on another task                                       | `create_thread` with the full brief. Send files with `upload_thread_file`, or push a branch, because a new thread does not see uncommitted work.                                                                                                                                    |

## Skills and paths

- `plugin-dev:skill-development` does not exist on Amp. Use Amp's built-in `building-skills` skill.
- The bundled `run` and `verify` skills do not exist on Amp. Use the project `verify` skill when the
  repository has one. Amp reads project skills in `.agents/skills/` and `.claude/skills/`. To drive
  a UI in an orb, run `amp orb desktop ensure` and connect `agent-browser --cdp` to the Chrome
  DevTools endpoint that it prints. Declare dev servers in `.amp/services.yaml`, and share a running
  service with a portal.
- `/setup-pstack` and the `pstack-models.md` override sheet do not exist on Amp. The role lines are
  in the "pstack models" section of your mode instructions. When that section has no line for a
  role, use the "Default" line.
- Reasoning effort levels (`@high`, `pstack:effort-<level>`) do not exist per call on Amp. Ignore
  them. The agent mode sets the effort.
- The agent store `~/.claude/orchestrate/<slug>/` is `~/orchestrate/<slug>/` in the orb of the
  thread that owns the program. It stays when the orb sleeps. Other threads cannot read it, so send
  them the files that they need with `upload_thread_file`.
- Skill files under `~/.claude/skills/` or `~/.claude/plugins/` are the skill directories that the
  `skill` tool loads on Amp.
- Claude Code hooks do not run on Amp. Your mode instructions hold the pstack routing rule that the
  `SessionStart` hook injects on Claude Code.

## Subagent policy

poteto-mode's Subagents section applies on Amp through `Task` and `create_thread`:

- There is no `subagent_type` parameter. For a pstack agent type, start the prompt with an
  instruction to read the agent file in full and follow it, then give the work. The agent files are
  in the `agents/` directory next to this file. Give the subagent the absolute path:
  - `pstack:poteto-agent` (and `pstack:poteto-agent-<level>`): `agents/poteto-agent.md`. Also give
    it the absolute path of the poteto-mode `SKILL.md`, as that file says.
  - `pstack:thermo-nuclear-review-subagent`: `agents/thermo-nuclear-review-subagent.md`.
  - `pstack:thermo-nuclear-code-quality-review-subagent`:
    `agents/thermo-nuclear-code-quality-review-subagent.md`.
  - `general-purpose` (and `pstack:effort-<level>`), or no `subagent_type`: no agent file. Claude
    Code's built-in types such as `Explore` and `Plan` do not exist on Amp, so put the constraint in
    the prompt.
- There is no `readonly` parameter. When a skill sets `readonly: true`, say in the prompt that the
  subagent must not change files.
- There is no `run_in_background` parameter. `create_thread` always runs in the background. Parallel
  `Task` calls in one response run at the same time.
- Use `Task` by default. Use `create_thread` only when the step names a model or a panel, needs its
  own checkout, or must keep running after this turn. Each thread starts an orb, so a large fan-out
  waits for orb capacity.
- Keep the rest of the policy unchanged. Pass file pointers, not inlined context. Review every
  subagent's diff yourself.

## Model names

Skills name models by Claude aliases (`opus`, `sonnet`, `haiku`, `fable`) and by other vendors'
model names in their panels. On Amp, you select a model through the agent mode of a thread. The
"pstack models" section of your mode instructions maps each name to an `agent_mode`. Use only the
modes in that section. Do not use a built-in mode (`low`, `medium`, `high`, `ultra`) or a Raw Models
mode for `create_thread`. Their Oracle and subagents use models that the user does not use.

A panel that names more models than the section has modes reuses modes in order. Say so in the
reply, because the panel is then less diverse.
