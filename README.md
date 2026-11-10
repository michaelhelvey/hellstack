<div align="center">
  <img src="./assets/mascot.png" alt="The hellstack mascot: a small demon mouse" width="320" />
  <h1>hellstack</h1>
</div>

> [!NOTE]
>
> If you're not me, you probably won't find this repository useful as-is. There's not a
> once-size-fits-all way to work with agents: you might prefer different skills, different
> harnesses, different inference providers, and many other things. While I think that the principles
> and techniques in this repository are broadly applicable, I don't recommend just installing and
> using it as-is. But you're free to do so if you want!

## Getting Started

**Pre-Requisites:**

- Bun (latest)
- Pi (latest), OpenCode (latest), or both

**Local Setup**

Clone this repository, run `bun install`, then `bun setup`. This will copy all relevant agent
configuration files into pi (`~/.pi/agent`) and OpenCode (`~/.config/opencode`) and set things up.
The command is idempotent, so you can run it as many times as you like.

OpenCode's `/review` command uses the hellstack `review` skill instead of the built-in review
prompt. For example, `/review high --fix` uses the high effort level and applies fixes. The command
runs in the current session. The skill selects when to use a subagent.

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
   for example, `ask_user_question`. The Jira and Confluence tools are an MCP server in
   `packages/jira`. Pi and OpenCode both reach it only from codemode scripts, so it costs no context
   until the `jira` skill uses it.
2. An AGENTS.md file that tells the agent what I think good software works with. I mostly write
   Typescript and Rust, so this is where this is targeted.
3. A set of skills relevant to the kinds of things that I work on. Almost all skills are
   `disable-model-invocation: true` -- I use skills mostly as prompt templates.

## About the name

A lot of people have appended a letter of their name + stack to refer to their agent skills and
plugins and what not. e.g. gstack, pstack, etc. Well, my last name is "Helvey" and I think that
working with LLMs is about as close to hell as I'll get in this life, so thus, hellstack.

## AI Generated Bullshit

It seems to make the clankers happy to add stuff to this README so I let them do it below this line.
Everything above this is me, The Human.

### OpenCode agents

The built-in `plan` agent is disabled. Add custom agents as Markdown files in
`packages/opencode/agents/`, then run `bun run setup` to copy them to `~/.config/opencode/agents/`
(or the configured OpenCode config folder). Setup updates files with the same name and keeps other
installed agents. To remove or rename an agent, also remove its old installed file.

Use `mode: primary` to select an agent with **Shift+Tab**:

```md
---
description: Reviews code changes
mode: primary
---

Review the current changes for bugs and regressions. Do not edit files.
```

The file name is the agent ID. For example, `reviewer.md` defines `reviewer`. OpenCode reloads the
installed files after setup. Use `/reload` if the list does not update.
