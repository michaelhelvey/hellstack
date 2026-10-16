<div align="center">
  <img src="./assets/mascot.png" alt="The hellstack mascot: a small demon mouse" width="320" />
  <h1>hellstack</h1>
  <p>My agent setup: <a href="https://pi.dev">pi</a> on my machines, <a href="https://ampcode.com">Amp</a> in orbs, <a href="https://github.com/cursor/plugins/tree/main/pstack">pstack</a> everywhere, and a chinchilla who talks to me.</p>
</div>

## Get started

You need [bun](https://bun.sh) and [pi](https://pi.dev). [herdr](https://herdr.dev) gives pi its
subagents, and the [Amp CLI](https://ampcode.com) is for publishing to Amp.

```sh
bun install
bun run sync
```

`bun run sync` points pi at this repository, then publishes the skills and the plugin to Amp. It
asks before it pushes to Amp.

Pi loads everything from this repository. After you change a file, type `/reload` in pi. Run
`bun run sync` again only to publish to Amp.

## What you get

- **Chinchilla mode.** Every agent, in pi and in every Amp mode, talks like a chinchilla.
- **pstack.** poteto's skills and playbooks, rewritten to work the same in pi and Amp. Agents route
  real work through `poteto-mode` without being told.
- **My skills.** jira, pr, review, tldraw, and more, next to pstack.
- **pi extensions.** Subagents in herdr panes, todos, goals, `/loop`, quick quotes, and more.

## Packages

| Package                                 | What it holds                                                       |
| --------------------------------------- | ------------------------------------------------------------------- |
| [`skills`](packages/skills/README.md)   | All the skills, pstack included. A pi package, and the Amp skills.  |
| [`pi`](packages/pi/README.md)           | The pi extensions. A pi package.                                    |
| [`amp`](packages/amp/README.md)         | The Amp plugin, and the commands that publish to Amp.               |
| [`prompts`](packages/prompts/README.md) | The text that every harness adds: instructions, chinchilla, pstack. |

## Commands

| Command                               | What it does                                                        |
| ------------------------------------- | ------------------------------------------------------------------- |
| `bun run sync`                        | Point pi at this repository, and publish to Amp.                    |
| `bun run amp:publish --dry-run`       | Show what Amp would get.                                            |
| `bun run amp:secrets [--set]`         | Show the Amp orb secrets, or set them from this shell.              |
| `bun run pstack diff`                 | Show the upstream pstack changes. Or tell an agent "update pstack". |
| `bun run skills:add <source> <skill>` | Install a skill from skills.sh.                                     |
| `bun run validate`                    | Format, lint, type-check, test, and check complexity.               |

## One machine only

- Packages: `pi install npm:<package>`. `bun run sync` keeps them.
- Skills: put them in `~/.pi/agent/skills/`.
- Models for pstack subagents: `~/.pi/agent/pstack-models.md` (see
  [`packages/pi`](packages/pi/README.md#pstack-models)).

If you're not me, edit [`packages/prompts/instructions.md`](packages/prompts/instructions.md) first.

## what's with the name?

well a bunch of ai people use `<letter>-<stack>` to talk about their shit, like
[gstack](https://github.com/garrytan/gstack). well my name is "helvey" and I think that using AI
agents is a form of hell, so thus, `hellstack`.
