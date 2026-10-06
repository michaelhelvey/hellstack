# @hellstack/global

Files that all agent harnesses share.

| File               | What it is                                                               |
| ------------------ | ------------------------------------------------------------------------ |
| `AGENTS.md`        | Global instructions for the agent. Pi, opencode, and Claude Code use it. |
| `pstack-models.md` | The model for each pstack role. The pstack skills read it.               |

`bun run sync` copies `AGENTS.md` to the global instructions file of each harness:

| Harness     | Path                           |
| ----------- | ------------------------------ |
| Pi          | `~/.pi/agent/AGENTS.md`        |
| opencode    | `~/.config/opencode/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md`          |

The file has my personal email. The `t4` layer puts my work email in its place (see
`hellstack.sync.ts`).

`bun run sync` also copies `pstack-models.md` to `~/.agents/pstack-models.md`. Use Opus for work
that needs judgment and Sonnet for rote work.
