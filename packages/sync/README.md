# @hellstack/sync

Copies the config and skills in this repository to Claude Code, opencode, and pi. Run it from the
repository root:

```sh
bun run sync            # copy everything, then install the integrations
bun run sync --dry-run  # show the changes only
```

| Source                 | Target                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| `global/AGENTS.md`     | `~/.claude/CLAUDE.md`, `~/.config/opencode/AGENTS.md`, `~/.pi/agent/AGENTS.md`    |
| `claude-code/config/*` | `~/.claude/*`                                                                     |
| `opencode/config/*`    | `~/.config/opencode/*`                                                            |
| `pi/agent/*`           | `~/.pi/agent/*`. The sync adds `packages/pi` to `packages` in `settings.json`.    |
| `skills/skills/<name>` | `~/.claude/skills/<name>` (Claude Code and opencode), `~/.pi/agent/skills/<name>` |

After it copies the files, the sync runs `herdr integration install claude` and
`herdr integration install pi`. It skips this step when `herdr` is not on the `PATH`. The list is in
`src/integrations.ts`. It does not install the herdr opencode integration, because that plugin does
not load in opencode v2. `@hellstack/opencode` has its own herdr plugin.

When `~/.config/.t4-ai-gateway/auth.json` exists, the sync then runs
`bunx @transport4/ai-gateway setup claude-code --key <token>` with the `token` from that file. This
adds the gateway config to `~/.claude/settings.json` again after the sync writes it. The token does
not go into this repository, and the output does not show it.

The sync changes only the files that it owns. Other files in the harness directories stay.

- It records each target in `~/.local/state/hellstack/manifest.json`. When you remove a file or a
  skill from this repository, the next sync removes it from the harness directories.
- When a target has changes that the last sync did not write (for example, a setting that you
  changed in a harness), the sync copies it to `~/.local/state/hellstack/backups/<time>/` before it
  overwrites it. Copy the change into this repository to keep it.

`CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `PI_CODING_AGENT_DIR`, and `XDG_STATE_HOME` change the
target directories.
