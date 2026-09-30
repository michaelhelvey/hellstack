# @hellstack/pi

Personal extensions and themes for [pi](https://pi.dev).

| Extension       | What it does                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `todo`          | File-based todos in `.pi/todos`. Adds the `todo` tool for the agent and the `/todos` manager.                                              |
| `uv`            | Replaces the `bash` tool. Blocks `pip`, `poetry`, and `python -m pip/venv/py_compile`.                                                     |
| `web-fetch`     | Adds the `web_fetch` tool, which returns a web page as Markdown.                                                                           |
| `herdr-prompts` | Shows the herdr pane as blocked while a dialog waits for an answer. Use it with `herdr integration install pi`, which `bun run sync` runs. |
| `whimsical`     | Shows a random working message on each turn.                                                                                               |

| Theme      | What it is                                  |
| ---------- | ------------------------------------------- |
| `nightowl` | Dark theme, based on the Night Owl palette. |
| `dayowl`   | Light theme, for use with `nightowl`.       |

Select a theme with `/settings`, or set `"theme": "nightowl"` in `~/.pi/agent/settings.json`.

## Install

Run `bun install` at the repository root, then `bun run sync`. The sync adds this package to
`packages` in `~/.pi/agent/settings.json`. Pi loads the source files directly, so changes apply
after `/reload` or a restart.

Use `pi config` to turn off one extension or theme.

## Agent files

`agent/` holds files for the pi agent folder (`~/.pi/agent`), such as `settings.json`. Pi does not
load these from a package. `bun run sync` copies them to `~/.pi/agent`. `AGENTS.md` is in
`@hellstack/global`.

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

After `pi update`, run this at the repository root:

```sh
bun run test:pi
```

If a devDependency test fails, install the pi version that it shows, then run `bun run test:pi`
again. The type check then finds API changes, and the other tests find changes in behavior.
