# @hellstack/opencode

Personal config and plugins for [opencode](https://opencode.ai) v2.

`config/` has the same layout as the opencode config folder (`~/.config/opencode`). `bun run sync`
copies its files to that folder. `AGENTS.md` is in `@hellstack/global`.

| File             | What it is                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| `opencode.jsonc` | Server config: permissions and server plugins.                           |
| `tui.jsonc`      | TUI config. It is empty.                                                 |
| `cli.json`       | CLI config: theme, session view, and CLI plugins.                        |
| `plugins/*`      | Local plugins. Opencode loads each file and folder in `plugins/` itself. |

| Plugin                 | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `get-current-model`    | Adds the `get_current_model` tool, which returns the session model.  |
| `herdr`                | Shows the opencode state (working, blocked, idle) in the herdr pane. |
| `opencode-quick-quote` | Type `>` at the start of a prompt line to quote the last reply.      |

Run `bun install` at the repository root to get the plugin types.

The `herdr` plugin replaces `herdr integration install opencode`. That command installs a plugin for
the opencode v1 plugin API, which opencode v2 does not load. Do not run it. The plugin reports state
only when opencode runs with `--standalone`, because the shared service does not get the environment
of the herdr pane.
