# @hellstack/gateway

Sets up the work AI gateway for [Claude Code](https://claude.com/claude-code) on this machine. The
gateway routes Claude Code through the T4 AI gateway.

`bun run sync` runs this step. Run it alone after a token change:

```sh
bun run gateway:claude
```

The command reads the token from `~/.config/.t4-ai-gateway/auth.json`. When
`~/.claude/settings.json` already holds that token, the command does nothing. When it does not, the
command runs the gateway setup, which writes `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS` to
the settings. The command is safe to run more than one time.

Without the auth file the command prints a message and does nothing.
