<div align="center">
  <img src="./assets/mascot.png" alt="The hellstack mascot: a small demon mouse" width="320" />
  <h1>hellstack</h1>
  <p>My agent setup: <a href="https://pi.dev">pi</a>, and a chinchilla who talks to me.</p>
</div>

## Get started

You need [bun](https://bun.sh) and [pi](https://pi.dev). [herdr](https://herdr.dev) gives pi its
subagents.

```sh
bun install
bun run sync
```

`bun run sync` points pi at this repository and sets up the work AI gateway for Claude Code.

Pi loads everything from this repository. After you change a file, type `/reload` in pi.

## What you get

- **Chinchilla mode.** Every agent talks like a chinchilla.
- **My skills.** jira, pr, review, tldraw, and more.
- **pi extensions.** Subagents in herdr panes, todos, goals, `/loop`, quick quotes, and more.

## Packages

| Package                                 | What it holds                                     |
| --------------------------------------- | ------------------------------------------------- |
| [`skills`](packages/skills/README.md)   | All the skills. A pi package.                     |
| [`pi`](packages/pi/README.md)           | The pi extensions. A pi package.                  |
| [`prompts`](packages/prompts/README.md) | The system prompt text: instructions, chinchilla. |
| [`gateway`](packages/gateway/README.md) | Sets up the work AI gateway for Claude Code.      |

## Commands

| Command                               | What it does                                             |
| ------------------------------------- | -------------------------------------------------------- |
| `bun run sync`                        | Point pi at this repository and set up the work gateway. |
| `bun run gateway:claude`              | Set up the work AI gateway for Claude Code.              |
| `bun run skills:add <source> <skill>` | Install a skill from skills.sh.                          |
| `bun run validate`                    | Format, lint, type-check, test, and check complexity.    |

## One machine only

- Packages: `pi install npm:<package>`. `bun run sync` keeps them.
- Skills: put them in `~/.pi/agent/skills/`.

If you're not me, edit [`packages/prompts/instructions.md`](packages/prompts/instructions.md) first.

## what's with the name?

well a bunch of ai people use `<letter>-<stack>` to talk about their shit, like
[gstack](https://github.com/garrytan/gstack). well my name is "helvey" and I think that using AI
agents is a form of hell, so thus, `hellstack`.
