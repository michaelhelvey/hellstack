---
name: herdr
description:
  Use Herdr (herdr-core) to start, watch, message, and wait for other agents, run background tasks,
  read or control terminals, work on other machines, or change what the user sees in the Herdr
  window. Requires HC_TERMINAL_ID.
---

# Herdr

This file is a pointer. The instructions live in the installed CLIs, so they always match their
versions.

Before anything else, run `hc --skill` and follow it. For the Herdr window, spaces, tabs, layouts,
mods, or worktrees, also run `herdr-app --skill` and follow it.

If `hc --skill` fails, the installed herdr-core is older than this skill. Use `hc --help` and
`hc COMMAND --help`. Do not use `herdr`; that command is the older terminal multiplexer.

## How to work in Herdr

- You are a terminal in herdr-core. `$HC_TERMINAL_ID` is your address. Agents that you start with
  `hc run` are your children, and they end when you end unless you use `--outlive-parent`.
- Delegate to interactive agents, not one-shot print modes. The user must be able to watch and steer
  each child. Put the first task in `hc run`; do not send it to an agent that is still starting.
- Tell every child how to report: `hc send $HC_TERMINAL_ID "<result or blocker>"` when it is done or
  stuck. A child report comes back to your input as an `<hc from="...">` tag. Read the real result
  before you summarize it.
- Wait with `hc wait --children all` or `hc wait <terminal>`. Do not sleep or poll. A timeout is a
  check-in, not a failure. If `send --wait` says `not_started`, read the terminal before you send
  again.
- Keep work visible. Do not redirect a terminal's output to a file or a pipe such that the user
  cannot see what the agent is doing.
- Show work proactively. Children stay under you in the Herdr agents list. Read their output, and
  use `herdr-app do terminal.peek` or `terminal.keep` when a result or status is useful to see. Add
  panels or mods only when they help the task; do not add gratuitous UI.
- For parallel work, agents that edit disjoint files can share one worktree with exact file
  ownership. If edits can overlap, or an agent needs an independent branch, give each agent its own
  git worktree. Both cases need exact file and folder ownership; do not let two agents edit the same
  file.
- Clean up only the terminals that you started and whose work you accepted: `hc kill <terminal>`,
  then `hc rm <terminal>`. Never stop or restart the herdr-core server.
- Use `herdr-app` for desktop changes only: spaces, tabs, panes, layouts, mods, and the worktree
  workflow. Read the installed guide at `~/.config/herdr-app/AGENTS.md` for mods and layouts. When
  the user wants worktrees as visible spaces, use the worktree workflow in `herdr-app --skill`. Keep
  children under their parent by default.
