# @hellstack/factory

A [pi](https://pi.dev) extension and CLI that run a factory of agents: one coordinator, one worker
per task, all on a task ledger in `$FACTORY_HOME` (default `~/.factory`).

`bun run sync` adds this package to your pi settings. Pi loads `src/index.ts` directly, so there is
no build step.

## Usage

```sh
bun run factory init           # make the ledger in $FACTORY_HOME (default ~/.factory)
bun run factory up             # start the coordinator and factoryd (safe to run again)
bun run factory status         # what runs, the task counts, the inbox, the last poll of each source
bun run factory down           # stop factoryd and the coordinator; workers continue
bun run factory board --json   # print the board model (what runs, tasks, inbox, source health, feed)
bun run factory open <task-id>             # start and focus the agent of a task in Herdr
bun run factory inbox dismiss <event-id>   # mark the notification done or resolve the issue
bun run factory inbox design <event-id>    # make a sketch from an inbox event and open its design agent
```

`open`, `inbox dismiss`, and `inbox design` print JSON with `--json`.

`factoryd` polls the sources in `config.json`, routes events to workers, the coordinator, or the
inbox, keeps workers and the coordinator running, and writes `feed.jsonl`. `up` runs it in the hc
terminal `factoryd`. To run it in the foreground without agents (it prints the messages instead of
sending them):

```sh
FACTORY_HOME=$(mktemp -d) bun run factory daemon --no-agents
```

The Herdr `factory` layout shows the board. See `packages/herdr/README.md`.

In any pi session, `/sketch <title>` starts a task for the current folder. The agent helps you write
the contract into the task file. Say that it is ready (or run `/handoff`), and the task goes to the
coordinator. `inbox design` does the same in a new design agent (terminal `factory-design-<id>`), in
the local checkout of the event repository: it looks in `repoRoots` of `config.json` (default
`["~/dev"]`).

The sources use the logins of `gh` (`gh auth login`) and `sentry` (`sentry auth login`).

`FACTORY_ROLE` gives a pi session its role. Spawn sets it; you do not set it by hand.

| `FACTORY_ROLE`                      | What the session gets                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `coordinator`                       | the `factory` skill, `COORDINATOR.md`, all `factory_*` tools, bash limited to 10 s          |
| `worker` (with `FACTORY_TASK=<id>`) | `WORKER.md`, `factory_task` for its own task, `/park` and `/unpark`                         |
| `design` (with `FACTORY_TASK=<id>`) | `DESIGN-AGENT.md`, the task template, `factory_task` and `factory_handoff` for its own task |
| `subagent`                          | the chinchilla rules only                                                                   |
| not set                             | `/sketch` only                                                                              |

`bun run sync` also runs `init`. It does not replace files that exist. Edit `~/.factory/config.json`
to set the models and the event sources. Other parts of the factory use the modules in `src/core`
(import `src/core/index.ts`). `DESIGN.md` has the contract.

## Assertions about Software Factories

I think the concept of "factory" is tainted from years of people building stuff like superpowers and
Gas Town and other mostrosities that didn't really provide much value except get you to the top of
an imaginary leaderboard. So I want to make some assertions about software factories that are the
guiding principle of this package. The Zen of software factories, if you will.

First, a definition:

**Task**: The unit of work within a software factory. It can be arbitrarily large, even ridiculously
so (for a human), but is defined by the following properties: 1) it has a clealy defined success
criteria (what the observable end-system state should be), 2) it has a clear, deterministic way to
be verified, 3) it has a clearly defined output (what do you want to see when it's done -- e.g. a
pull request, or a release, or a report), and 4) it has clearly defined constraints (what infra are
you allowed to use? what permissions? what libraries? etc)

Now, the rules:

1. Making agents role play as humans in a software team doesn't result in better software.
2. Splitting up a task that already meets the criteria above doesn't help (except in some cases, to
   improve performance via parallelism).
3. LLMs can't read your mind. If your task sucks, they'll suck.
4. More code != better software. The goal of a factory shouldn't be to produce more code. The goal
   should be to automate the most repetitive parts of agent steering in order to give you more time
   to write better software.
5. There's not a one size fits all approach here that works -- different projects will have
   different requirements. Different ways of verification. Different ways of "delivering" work. The
   goal of a factory should be to provide building blocks and processes that you can compose
   together in order to get the work done.

## Components

1. The super-agent. A super agent is not an architect, a developer, or any of the above. It exists
   purely as an intelligent, natural language frontend to the factory: what work is in the hopper,
   what's in progress and where, what needs your attention, and what's delivered. It routes tasks
   and ensures that the entire system is proactive, rather than reactive.
2. Runtime. Agents need an environment where they can talk to other agents, spawn subagents, route
   work, etc. For me, this is herdr (the runtime, not the GUI app. I don't love the GUI app).
3. "Worker" agents. A worker agent takes in a "task" and completes it. It might sometimes use
   subagents, but this is honestly the least important part. Modern SOTA models are really good at
   "doing tasks" as long as they're well defined and you tell them up front how you want to write
   code. Don't overthink this part.
4. Delivery. Once a worker agent "delivers" the code, it needs to be shepherded "out". What does
   this mean? 1) Deploying it somewhere and making sure that it works 2) Getting you to review it
   and making sure you don't have any objections. 3) Making a pull request and watching it for
   review comments / approvals. Basically watching the completed code until it "lands."

Other workflows can run in parallel to this (e.g. monitoring Sentry for issues, and doing research
in order to create a "task" that is an input to the factory), but they aren't part of this core
state machine which exists in order to get tasks done.

Deepseek notes the following things about a super-agent which I think are good:

- Continuous: Users can interact with it directly where they already work, such as IM chats and
  GitHub comments, and it always feels like one agent. They never have to wonder whether session X
  has information Y in its context. For example, if a user asks for Plan A in IM and later switches
  to Plan B in a GitHub Pull Request comment, the agent understands the change and adjusts what it
  is doing.
- Productive: It responds quickly and completes several complex tasks in parallel, each to a high
  standard. It can take the next instruction before the previous command or task has finished.
- Proactive: It does not wait for step-by-step instructions. It monitors events in its environment,
  acts on anything worth handling, and stays quiet otherwise.
- Persistent: It is always online, connects directly to the user's real working environments, and
  recovers automatically from anomalies during long-running operation.
