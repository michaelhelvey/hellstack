# @hellstack/pi

Personal extensions for [pi](https://pi.dev).

| Extension         | What it does                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompts`         | Adds [`@hellstack/prompts`](../prompts/README.md) (instructions, the chinchilla voice) to the system prompt, with the pi notes (`src/prompts/pi.md`). |
| `ask`             | Adds the `ask_user_question` tool: questions with fixed choices in a dialog.                                                                          |
| `loop`            | Adds `/loop [interval] <prompt>` and the `schedule_wakeup` tool. Without an interval, the agent schedules each next run itself. `/loop stop` ends it. |
| `goal`            | Tracks a long-running objective across turns, with continuation, status, and budget handling.                                                         |
| `todo`            | File-based todos in `.pi/todos`. Adds the `todo` tool for the agent and the `/todos` manager.                                                         |
| `session-history` | Adds `session_list`, `session_search`, and `session_read` for codemode scripts, to read past sessions. See below.                                     |
| `uv`              | Replaces the `bash` tool. Blocks `pip`, `poetry`, and `python -m pip/venv/py_compile`.                                                                |
| `web-fetch`       | Adds the `web_fetch` tool, which returns a web page as Markdown.                                                                                      |
| `chrome-devtools` | Adds the `chrome-devtools` MCP server for codemode scripts. It controls your own Chrome session. See below.                                           |
| `sentry`          | Adds the remote Sentry MCP server for codemode scripts. Sign in once with `/mcp login sentry`.                                                        |
| `herdr-prompts`   | Shows the herdr pane as blocked while a dialog waits for an answer. Use it with `herdr integration install pi`, which `bun run sync` runs.            |
| `multiplexer`     | In herdr or Rex, loads the matching skill and tells the agent to use it to work with other agents. See below.                                         |
| `whimsical`       | Shows a random working message on each turn.                                                                                                          |
| `quick-quote`     | Type `>` at the start of a line to quote a paragraph of the last reply. See below.                                                                    |
| `skill-commands`  | Start a skill with `/name` anywhere in the prompt, not only with `/skill:name` at the start. See below.                                               |

## Multiplexer

`multiplexer` finds the terminal multiplexer that pi runs in, from the environment: herdr
(`HERDR_ENV=1`) or Rex (`REX_SESSION`). In a herdr pane in a Rex terminal, herdr has priority. The
extension then:

- Loads the `herdr` or `rex` skill from [`@hellstack/skills`](../skills/README.md). Pi does not load
  these skills in other sessions.
- Adds a short section to the system prompt. It tells the agent to use the skill to find, start,
  talk to, and stop other agents, and to close the tabs and panes that it does not need.

The agent keeps no list of agents. It reads the panes from the multiplexer each time, so you can
tell one agent to talk to an agent in a different tab or session. Give your tabs names that tell
their task, so that agents can find them.

`bun run sync` turns off the `rex` skill that `rex skill setup` puts in `~/.agents/skills`, so that
pi loads only the copy in this repository.

## Session history

`session-history` lets the agent read your past pi sessions, for example when you ask "catch me up
on this repository". The tools are only for codemode scripts:

| Tool             | What it returns                                                                       |
| ---------------- | ------------------------------------------------------------------------------------- |
| `session_list`   | The sessions, newest first, with the first user message of each.                      |
| `session_search` | The messages that contain all words of `query`, newest first.                         |
| `session_read`   | The transcript of the active branch of one session. The default is the last 50 items. |

All tools use the sessions of the current directory. Set `scope: "all"` to use the sessions of all
directories. Tool calls and tool results are not included unless you set `include_tools: true`.

## Chrome DevTools

`chrome-devtools` runs
[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) with `--autoConnect`.
It always connects to the Chrome that you use, with your tabs and sign-ins. It never starts a
different browser.

1. Use Chrome 144 or later.
2. Open `chrome://inspect/#remote-debugging` and turn on remote debugging.
3. On macOS, give your terminal Full Disk Access. The server reads `DevToolsActivePort` from the
   Chrome profile folder, and macOS blocks this read for apps without access to the data of other
   apps.

Chrome asks you to allow each new connection. Scripts call the tools as
`tools.mcp__chrome_devtools__<tool>`, for example `tools.mcp__chrome_devtools__list_pages({})`.

Pi starts each MCP server when a session starts. The extension gives pi a small server
(`src/chrome-devtools/lazy-server.ts`) that answers the tool list from
`~/.cache/hellstack/chrome-devtools-mcp-<key>.json`, and starts `chrome-devtools-mcp` on the first
tool call. The first session without this file starts the server at once and writes the file. To get
a new tool list, delete the file.

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
settings in `agent-settings.json`. It keeps the other settings and packages of the machine.

Pi loads the extensions from `dist`, not from `src`: one bundle loads faster than many source files.
After you change `src`, run `bun run build`, then `/reload`. `bun run sync` and `bun run test` also
build.

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
