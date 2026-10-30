# @hellstack/pi

Personal extensions for [pi](https://pi.dev).

| Extension        | What it does                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompts`        | Adds [`@hellstack/prompts`](../prompts/README.md) (instructions, the chinchilla voice, pstack) to the system prompt, with the pi notes (`src/prompts/*.md`) and the pstack models sheet. |
| `ask`            | Adds the `ask_user_question` tool: questions with fixed choices in a dialog.                                                                                                             |
| `loop`           | Adds `/loop [interval] <prompt>` and the `schedule_wakeup` tool. Without an interval, the agent schedules each next run itself. `/loop stop` ends it.                                    |
| `goal`           | Tracks a long-running objective across turns, with continuation, status, and budget handling.                                                                                            |
| `todo`           | File-based todos in `.pi/todos`. Adds the `todo` tool for the agent and the `/todos` manager.                                                                                            |
| `uv`             | Replaces the `bash` tool. Blocks `pip`, `poetry`, and `python -m pip/venv/py_compile`.                                                                                                   |
| `web-fetch`      | Adds the `web_fetch` tool, which returns a web page as Markdown.                                                                                                                         |
| `herdr-prompts`  | Shows the herdr pane as blocked while a dialog waits for an answer. Use it with `herdr integration install pi`, which `bun run sync` runs.                                               |
| `herdr-agents`   | Runs subagents as pi agents in herdr or Rex panes, and shows them above the editor. Adds the `subagent_*` tools and `/agents` (`/agents stop [id\|all]`). See below.                     |
| `whimsical`      | Shows a random working message on each turn.                                                                                                                                             |
| `quick-quote`    | Type `>` at the start of a line to quote a paragraph of the last reply. See below.                                                                                                       |
| `skill-commands` | Start a skill with `/name` anywhere in the prompt, not only with `/skill:name` at the start. See below.                                                                                  |

## pstack models

The pstack skills pick the model of a subagent by role, for example `arena runners`. Write the
models of this machine in `~/.pi/agent/pstack-models.md`, as `provider/model`. A panel gets one
subagent for each model. Without the file, every role runs on the session model. The roles are in
the Amp sheet, [`pstack-amp.md`](../amp/plugin/hellstack/pstack-amp.md).

```markdown
- strongest judgment: claude-bridge/claude-fable-5-1
- feature, refactoring, bug-fix, perf-issue, hillclimb: claude-bridge/claude-opus-5-5
- arena runners, architect runners, interrogate reviewers: claude-bridge/claude-opus-5-5,
  github-copilot/gpt-6.1-sol
```

## Subagents

`herdr-agents` works when pi runs in a herdr pane or a Rex terminal. At startup, it finds which one
from the environment (`HERDR_ENV` or `REX_SESSION`). Outside both, its tools and `/agents` show an
error. In Rex, pi reports the state of each subagent itself, so Rex needs no integration.

- The subagents go in the current herdr workspace or Rex session, in tabs named
  `<project>-<group>-<n>`, for example `hellstack-review-1`. The model sets the group when it starts
  a subagent. A tab holds at most 8 subagents.
- Each subagent is `pi --model <model>` in its own pane. Subagents do not get the subagent tools.
- When a subagent finishes, the parent gets its last reply in a message, and the subagent closes. A
  blocked subagent stays open.
- A message to a closed subagent resumes it: pi starts again in a new pane with the same session, so
  the subagent keeps its full history. A subagent whose pane you closed does not resume.
- The parent keeps its subagents in memory only. When you quit pi or change the session, pi stops
  the subagents. After `/reload`, or when the parent process stops, the subagents continue to run
  without a parent.

## Quick quote

Type `>` at the start of a line in the editor. A picker shows the paragraphs, list items, and code
blocks of the last assistant replies. Type words after `>` to filter them, for example
`> worktree prune`.

| Key                        | Action                                    |
| -------------------------- | ----------------------------------------- |
| `↑` `↓`, `ctrl+p` `ctrl+n` | Move the selection.                       |
| `enter`, `tab`             | Insert the selection as a Markdown quote. |
| `esc`                      | Close the picker. The text stays.         |

You can also click a row.

## Skill commands

Type `/name` to start the skill `name`. The token can be anywhere in the prompt, and one prompt can
start more than one skill:

```text
fix the flaky test with /debugging, then open a PR with /pr
```

- The extension adds the text of each skill before your prompt, as `/skill:name` does.
- The editor shows the skills when you type `/` in the prompt. `tab` or `enter` completes the name.
- At the start of the prompt, the menu shows `/name` in place of `/skill:name`. `/skill:name` still
  works.
- A command or a prompt template with the same name as a skill runs in place of the skill.

## Editor

`quick-quote` and `skill-commands` use one shared editor. If another extension replaces the editor,
these features stop.

## Install

`bun run sync` at the repository root adds this package and
[`@hellstack/skills`](../skills/README.md) to `packages` in `~/.pi/agent/settings.json`, with the
settings in `agent-settings.json`. It keeps the other settings and packages of the machine. Pi loads
the files from this repository, so a change applies after `/reload`.

Use `pi config` to turn off one extension. Install packages that only one machine needs with
`pi install`.

## Configuration

| Variable         | Default                   | Used by     |
| ---------------- | ------------------------- | ----------- |
| `PI_TODO_PATH`   | `.pi/todos`               | `todo`      |
| `WEB_FETCH_BIN`  | `~/.cargo/bin/web-fetch`  | `web-fetch` |
| `LIGHTPANDA_BIN` | `~/.local/bin/lightpanda` | `web-fetch` |

The todo folder can have a `settings.json` file. The default is `{ "gc": true, "gcDays": 7 }`: at
session start, pi deletes closed todos that are older than `gcDays` days.

## Tests

The tests in `tests/e2e` start the installed `pi` with this package, a fake model, and a temporary
agent folder. They do not use your settings, your credentials, or a real model. Set `PI_BIN` to test
a different pi binary.

Update pi with this command at the repository root, not with `pi update`:

```sh
bun run pi:update
```

It runs `pi update`, sets the pi devDependencies to the new pi version, and runs the pi tests. The
type check then finds API changes, and the other tests find changes in behavior. Arguments go to
`pi update`.

If you ran `pi update` directly, the devDependency tests fail. Run `bun run pi:update` to fix them.
