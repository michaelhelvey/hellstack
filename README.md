# @michaelhelvey/hellstack

How I work with LLMs.

> [!NOTE] If you're not me, you probably won't find this repository useful as-is. There's not a
> once-size-fits-all way to work with agents: you might prefer different skills, different
> harnesses, different inference providers, and many other things. While I think that the principles
> and techniques in this repository are broadly applicable, I don't recommend just installing and
> using it as-is. But you're free to do so if you want!

## Getting Started

**Pre-Requisites:**

- Bun (latest)
- Pi (latest)
- herdr-core (latest)

**Local Setup**

Clone this repository, run `bun install`, then `bun setup`. This will copy all relevant agent
configuration files and set things up. The command is idempotent, so you can run it as many times as
you like.

Setup appends a machine-specific layer from `packages/pi/agent/layers` to `AGENTS.md`, selected by
the username on the machine (see `LAYERS` in `packages/pi/src/setup.ts`).

Pi loads the extension from the bundle `packages/pi/dist/index.js`, not from `src`: loading the
source makes pi start seconds slower. `bun setup`, `bun run pi`, and the tests make the bundle.
After you change the source, run `bun run build` (or `bun setup`) so that your pi gets the change.

## About

Hellstack is built on a few important principles that I've learned over the last few years of
working with coding agents.

1. The bitter lesson. Big-brain workflows, subagents, swarms, and other highly engineered agent
   configuration mostly collapse in favor of better models. Avoid over-harnessing. A simple document
   stating how you like to build software, along with some carefully crafted tools and prompts, is
   enough for all but the most specialized of tasks.
2. Basically everything about software engineering is automatable, except for the actual process of
   reading, writing, and understanding the code. You can automate fetching Sentry tickets, Github
   issues, pull requests, making sure CI is green, verifying your changes against a deployed
   environment, and lots of other things. But the core, inner loop of 1) figure out what you are
   trying to do 2) figure out what code needs to exist in order to make that happen 3) producing
   that code is -- even where agents are heavily involved -- fairly freeform and interactive. I'm
   not saying that you have to write all the code yourself. I'm just saying that there's not a
   magical skill, workflow, or harness that will absolve you from the hard intellectual work of
   understanding what you're doing.
3. The most limited resource is your own attention. The art of harnessing is only partly about
   improving model outcomes: it's just as much or more about optmizing the process of building
   software so that you, the human, are devoting your limited attention resource to the right
   things. For example, while subagents are powerful, I would argue that their primary purpose is
   not in improving the outcome of a task, but rather sparing you the intellectual effort of
   managing trivial or repetitive work by moving it off of the main thread.

As a result, hellstack is structured in the following way:

1. A pi plugin that provides a few minimal tools that make it easier for agents to work with me --
   for example, `ask_user_question`. The Jira and Confluence tools live in `packages/jira`, and are
   only reachable from codemode scripts, so they cost no context until the `jira` skill uses them.
2. An AGENTS.md file that tells the agent what I think good software works with. I mostly write
   Typescript and Rust, so this is where this is targeted.
3. A set of skills relevant to the kinds of things that I work on. Almost all skills are
   `disable-model-invocation: true` -- I use skills mostly as prompt templates.
4. A very minimal framework for agent communication. This allows simple sub-agent and coordinator
   agent patterns. For right now, I use herdr-core as the runtime, but I'm actively looking to
   replace this with something of my own, as I don't like herdr very much (no hate to the authors,
   I'm just idiosyncratic).

## Subagents

`packages/herdr` adds the `agent_spawn`, `agent_send`, `agent_read`, `agent_stop`, `agent_list`,
`agent_wait`, and `report` tools. A pi agent uses them to start pi subagents in herdr-core (`hc`)
terminals. Reports from subagents arrive in the parent as messages, so the parent does not poll.
Subagents show in the herdr-app window, in one space for the folder of the top agent.

The tools work only when pi runs in an hc terminal. These zsh functions start pi in hc:

```zsh
# pi in an hc terminal. Closing the pane ends pi and its subagents; ctrl+\ detaches.
hpi() {
  emulate -L zsh
  setopt localtraps
  local id
  id=$(hc run --bg --json pi "$@" | jq -r .address) || return
  trap "hc kill $id >/dev/null 2>&1" HUP TERM
  hc attach "$id"
}

# A long-lived coordinator pi, shown in herdr-app. Attaches to the live one with the name, or
# starts it with the coordinator prompt. Closing the pane only detaches: end it in herdr-app.
coord() {
  emulate -L zsh
  local name=${1:-coordinator}
  [[ $(hc get "$name" --json 2>/dev/null | jq -r .state) == live ]] ||
    hc run --bg --name "$name" --label hellstack.show=1 \
      pi --append-system-prompt ~/.pi/agent/COORDINATOR.md >/dev/null || return
  hc attach "$name"
}
```

`bun setup` copies `packages/pi/agent/COORDINATOR.md` to `~/.pi/agent/COORDINATOR.md`. It tells the
coordinator to talk to you, stay unblocked, and dispatch well-defined tasks to subagents.

Do not use `hc run pi` without `--bg`: it returns when pi becomes idle, and pi continues without a
screen.
