# @hellstack/global

Files that all agent harnesses share.

| File        | What it is                                                               |
| ----------- | ------------------------------------------------------------------------ |
| `AGENTS.md` | Global instructions for the agent. Pi, opencode, and Claude Code use it. |

`bun run sync` copies `AGENTS.md` to the global instructions file of each harness:

| Harness     | Path                           |
| ----------- | ------------------------------ |
| Pi          | `~/.pi/agent/AGENTS.md`        |
| opencode    | `~/.config/opencode/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md`          |

The file has my personal email. The `t4` layer puts my work email in its place (see
`hellstack.sync.ts`).
