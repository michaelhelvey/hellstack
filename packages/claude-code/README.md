# @hellstack/claude-code

Personal config for [Claude Code](https://claude.com/claude-code).

`config/` has the same layout as the Claude Code config folder (`~/.claude`). `bun run sync` copies
its files to that folder. `CLAUDE.md` is in `@hellstack/global`.

| File            | What it is                                                                 |
| --------------- | -------------------------------------------------------------------------- |
| `settings.json` | User settings: model, effort, permissions, plugins, spinner verbs, and UI. |

## Mermaid

`bun run sync` writes a mod to `~/.claude/mods/mermaid` and sets `CLAUDE_CODE_PLUGIN_DIRS` in
`settings.json` to load it. The mod draws ` ```mermaid ` blocks in replies as Unicode diagrams, the
same as pi (it uses the same library, `grok-mermaid`). When a diagram is wider than the terminal, or
the library cannot draw it, the reply shows the source. The sync bundles the hooks module from
`src/mermaid/register.ts`. Do not add the bundle to the repository.

Do not add the herdr hook to `settings.json`. After it copies the files, `bun run sync` runs
`herdr integration install claude`, which adds the hook and its script.

When the `t4` layer is on and `~/.config/.t4-ai-gateway/auth.json` exists, `bun run sync` then runs
`bunx @transport4/ai-gateway setup claude-code --key <token>` with the `token` from that file. This
adds the gateway config to `~/.claude/settings.json` again after the sync writes it. The token does
not go into this repository, and the output does not show it.
