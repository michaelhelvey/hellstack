# hellstack

stuff for working with clankers. Plugins, skills, etc. pi stuff shamelessly modeled and stolen from
https://github.com/mitsuhiko/agent-stuff

## Get started

You need [bun](https://bun.sh). [uv](https://docs.astral.sh/uv/) runs the complexity check, and
[herdr](https://herdr.dev) is optional.

```sh
bun install
bun run sync --dry-run  # show what the sync changes
bun run sync            # copy everything to Claude Code, opencode, and pi
```

The sync copies files. It does not make links. After you change a file in this repository, run
`bun run sync` again. See [`packages/sync`](packages/sync/README.md) for the targets, the manifest,
and the backups.

If you're not me, edit `./packages/global/AGENTS.md` so that it reflects your name and email and
what you want.

## Structure

This is a bun workspace. Each package in `packages/` holds one part of the setup:

| Package                                         | What it holds                                                 |
| ----------------------------------------------- | ------------------------------------------------------------- |
| [`global`](packages/global/README.md)           | `AGENTS.md`, the global instructions for all harnesses.       |
| [`claude-code`](packages/claude-code/README.md) | Claude Code settings.                                         |
| [`opencode`](packages/opencode/README.md)       | opencode config and local plugins, including a herdr plugin.  |
| [`pi`](packages/pi/README.md)                   | pi extensions, themes, and agent settings.                    |
| [`skills`](packages/skills/README.md)           | The skills for all harnesses, and the commands for skills.sh. |
| [`sync`](packages/sync/README.md)               | The `bun run sync` command.                                   |

In each harness package, `config/` or `agent/` has the same layout as the harness directory.

## Commands

Run these from the repository root:

| Command                               | What it does                                                       |
| ------------------------------------- | ------------------------------------------------------------------ |
| `bun run sync [--dry-run]`            | Copy everything to the harness directories.                        |
| `bun run skills:add <source> <skill>` | Install a skill from skills.sh.                                    |
| `bun run skills:update [skill...]`    | Update skills from skills.sh.                                      |
| `bun run skills:remove <skill...>`    | Remove skills from skills.sh.                                      |
| `bun run validate`                    | Format, then lint, type-check, test, and run the complexity check. |

## what's with the name?

well a bunch of ai people use `<letter>-<stack>` to talk about their shit, like
[pstack](https://github.com/cursor/plugins/tree/main/pstack) and
[gstack](https://github.com/garrytan/gstack). well my name is "helvey" and I think that using AI
agents is a form of hell, so thus, `hellstack`.
