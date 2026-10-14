# @hellstack/pi

Personal extensions and themes for [pi](https://pi.dev).

| Extension       | What it does                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `btw`           | Opens a side conversation for focused questions, with optional summary injection into the main chat.                                                          |
| `goal`          | Tracks a long-running objective across turns, with continuation, status, and budget handling.                                                                 |
| `todo`          | File-based todos in `.pi/todos`. Adds the `todo` tool for the agent and the `/todos` manager.                                                                 |
| `uv`            | Replaces the `bash` tool. Blocks `pip`, `poetry`, and `python -m pip/venv/py_compile`.                                                                        |
| `web-fetch`     | Adds the `web_fetch` tool, which returns a web page as Markdown.                                                                                              |
| `herdr-prompts` | Shows the herdr pane as blocked while a dialog waits for an answer. Use it with `herdr integration install pi`, which `bun run sync` runs.                    |
| `herdr-agents`  | Runs subagents as pi agents in herdr panes, and shows them above the editor. Adds the `subagent_*` tools and `/agents` (`/agents stop [id\|all]`). See below. |
| `whimsical`     | Shows a random working message on each turn.                                                                                                                  |

## Subagents

`herdr-agents` works only when pi runs in a herdr pane. Outside herdr, its tools and `/agents` show
an error.

- The subagents go in the current workspace, in tabs named `<project>-<group>-<n>`, for example
  `hellstack-review-1`. The model sets the group when it starts a subagent. A tab holds at most 8
  subagents.
- Each subagent is `pi --model <model>` in its own pane. Subagents do not get the subagent tools.
- When a subagent finishes, the parent gets its last reply in a message, and the subagent closes. A
  blocked subagent stays open.
- A message to a closed subagent resumes it: pi starts again in a new pane with the same session, so
  the subagent keeps its full history. A subagent whose pane you closed does not resume.
- The parent keeps its subagents in memory only. When you quit pi or change the session, pi stops
  the subagents. After `/reload`, or when the parent process stops, the subagents continue to run
  without a parent.

## Install

Run `bun install` at the repository root, then `bun run sync`. The sync adds this package to
`packages` in `~/.pi/agent/settings.json`. Pi loads the source files directly, so changes apply
after `/reload` or a restart.

Use `pi config` to turn off one extension or theme.

## Agent files

`agent/` holds files for the pi agent folder (`~/.pi/agent`), such as `settings.json`. Pi does not
load these from a package. `bun run sync` copies them to `~/.pi/agent`. `AGENTS.md` is in
`@hellstack/global`.

The `t4` layer adds the AI gateway plugin (see `hellstack.sync.ts`). The sync does not set models.
It keeps `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, and `enabledModels` from the
current `settings.json` on each machine.

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
