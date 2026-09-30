# @agent-stuff/opencode

Personal config and plugins for [opencode](https://opencode.ai) v2.

`config/` has the same layout as the opencode config folder (`~/.config/opencode`). Copy or link its
files to that folder to use them. `AGENTS.md` is in `@agent-stuff/global`.

| File             | What it is                                                    |
| ---------------- | ------------------------------------------------------------- |
| `opencode.jsonc` | Server config: permissions and server plugins.                |
| `tui.jsonc`      | TUI config. It is empty.                                      |
| `cli.json`       | CLI config: theme, session view, and CLI plugins.             |
| `plugins/*.ts`   | Local plugins. Opencode loads each file in `plugins/` itself. |

| Plugin                 | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `get-current-model`    | Adds the `get_current_model` tool, which returns the session model. |
| `opencode-quick-quote` | Type `>` at the start of a prompt line to quote the last reply.     |

Run `bun install` at the repository root to get the plugin types.
