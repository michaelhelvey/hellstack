# @hellstack/opencode

Personal config and plugins for [opencode](https://opencode.ai) v2.

`config/` has the same layout as the opencode config folder (`~/.config/opencode`). `bun run sync`
copies its files to that folder. `AGENTS.md` is in `@hellstack/global`.

| File             | What it is                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| `opencode.jsonc` | Server config: permissions and server plugins.                           |
| `tui.jsonc`      | TUI config for opencode v1. It registers only the herdr plugin.          |
| `cli.json`       | CLI config: theme, session view, and CLI plugins.                        |
| `plugins/*`      | Local plugins. Opencode loads each file and folder in `plugins/` itself. |

| Plugin                 | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `get-current-model`    | Adds the `get_current_model` tool, which returns the session model. |
| `opencode-quick-quote` | Type `>` at the start of a prompt line to quote the last reply.     |

Run `bun install` at the repository root to get the plugin types.

The `t4` layer adds the AI gateway plugin to `plugins` in `opencode.jsonc` (see
`hellstack.sync.ts`).

`bun run sync` runs `herdr integration install opencode`, which adds the herdr plugins to the
opencode config folder. `cli.json` and `tui.jsonc` already register these plugins, so the install
does not change them. It needs herdr 0.9.0 or later.
