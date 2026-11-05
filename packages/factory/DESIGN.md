# Factory design

This file is the contract between the parts of the factory. Read it before you change a part. Keep
it current when a contract changes.

## Goal

One coordinator agent that the user talks to about all work. It is always unblocked. It shepherds
tasks through workers until each task lands. Code does the deterministic parts. Prose does the rest.
Keep the code small. Do not add process that a capable model does not need.

## Parts

| Part       | Where                                        | Runtime | What it does                                                    |
| ---------- | -------------------------------------------- | ------- | --------------------------------------------------------------- |
| core       | `src/core/`                                  | Node    | Ledger paths, config, task files, inbox, feed, hc, worker spawn |
| `factoryd` | `src/daemon/`                                | bun     | Poll, filter, route, reconcile, keepalive, watchdog, feed       |
| extension  | `src/index.ts`, `src/extension/`             | Node    | Roles, prompt injection, tools, commands, bash timeout          |
| CLI        | `src/cli.ts`                                 | bun     | `init`, `up`, `down`, `status`, `board`                         |
| prose      | `prompts/`, `skills/factory/`                | -       | `chinchilla.md`, `WORKER.md`, coordinator seed, task template   |
| board      | `packages/herdr/config/mods/factory-board`   | Herdr   | The board mod                                                   |
| layout     | `packages/herdr/config/layouts/factory.json` | Herdr   | The `factory` layout                                            |

Pi runs the extension with Node, so `src/core` and `src/extension` must not use `Bun` APIs. The
daemon and the CLI run with bun and can use `Bun` APIs, but prefer the core functions.

## Ledger

The ledger is global for one machine. `FACTORY_HOME` selects it (core makes it absolute). The
default is `~/.factory`. Tests always set `FACTORY_HOME` to a temporary folder.

```
~/.factory/
  config.json        machine config (sources, models). factoryd reloads it when it changes.
  COORDINATOR.md     the coordinator's memory. The coordinator edits it.
  tasks/<id>.md      one file per task. The source of truth for the task.
  inbox/<id>.json    one file per event that no task owns.
  feed.jsonl         one record per poll cycle or daemon action. Append only.
  state/             daemon state: daemon.json (poll cursors, seen event ids, notices sent,
                     messages that wait for the coordinator), factoryd.pid (the daemon lock).
```

`factory init` makes the folders, writes the default `config.json`, and copies
`prompts/COORDINATOR.seed.md` to `COORDINATOR.md`. It does not replace files that exist.

## Task file

A task file is Markdown with YAML front matter. Parse it with the `yaml` package and validate it
with zod. The body is free prose with fixed `##` sections.

```markdown
---
id: t-7f3a
title: Add the factory router
status: working
repo: /Users/me/dev/helvetici/hellstack
threads: [gh:helvey/hellstack#88]
paused: false
needs_you: null
now: waiting on review from @someone
created: 2026-11-05T14:00:00.000Z
updated: 2026-11-05T15:12:00.000Z
---

## Goal

## Verification

## Output

## Constraints

## Landing

- [x] PR opened
- [ ] merged

## Log

- 2026-11-05T15:12:00.000Z worker: opened PR #88
```

Front matter fields:

| Field       | Type              | Meaning                                                               |
| ----------- | ----------------- | --------------------------------------------------------------------- |
| `id`        | `t-` + 4 to 8 hex | Unique. The file name is `<id>.md`.                                   |
| `title`     | string            | Short.                                                                |
| `status`    | see below         | The lifecycle state.                                                  |
| `repo`      | absolute path     | The worker's working directory.                                       |
| `threads`   | string[]          | Thread keys that the task owns. Events on them go to the task worker. |
| `paused`    | boolean           | When true, the reconciler does not start or restart the worker.       |
| `needs_you` | string or null    | A question for the user. Not null puts the task in "needs you".       |
| `now`       | string            | One line: what happens now.                                           |
| `created`   | ISO time          |                                                                       |
| `updated`   | ISO time          | Every write through core sets it.                                     |

Status values: `sketch`, `ready`, `working`, `landing`, `landed`, `dropped`.

```
sketch → ready → working → landing → landed
  any  → dropped
ready → sketch, landing → working
```

`updateTask` accepts only these changes (`statusTransitions` in core). `landed` and `dropped` are
final.

- `sketch`: someone works on the contract. Nothing acts on it.
- `ready`: the contract is complete. The coordinator dispatches it.
- `working`, `landing`: a worker owns it. The reconciler keeps the worker running.
- `landed`, `dropped`: done. Nothing acts on it.

**Handoff** is the only way from `sketch` to `ready`. Handoff fails unless Goal, Verification,
Output, and Constraints have text (HTML comments do not count), Landing has at least one checkbox
item, and `repo` is a folder that exists. Handoff is the same for every source: the user with a
design agent, a coordinator proposal, or a file that someone wrote by hand.

**Landing progress** is the count of checked items and all items in the Landing section.

Core functions read and write task files. They keep unknown sections, unknown front matter fields,
and prose. Headings and checkboxes in fenced code blocks do not count. Each core write takes the
lock file `tasks/<id>.md.lock`, so writes of different processes do not lose an update. The file
name must be `<id>.md`; else the task is not valid. Agents can edit the prose with their edit tools.
Agents change front matter and the log through the `factory_task` tool, so that `updated` stays
correct.

## Thread keys

| Source | Key                                                       |
| ------ | --------------------------------------------------------- |
| GitHub | `gh:<owner>/<repo>#<number>` (issue or PR)                |
| GitHub | `gh:<owner>/<repo>` (a subject without a number, e.g. CI) |
| Sentry | `sentry:<org>/<shortId>`                                  |
| Task   | `task:<id>`                                               |

## Events

An event is a normalized record from a source:

```ts
{
  id: string;
  source: "github" | "sentry";
  thread: string;
  kind: string;
  title: string;
  summary: string;
  url: string;
  ts: string;
}
```

`kind` examples: `pr_comment`, `review_requested`, `review`, `ci`, `mention`, `security_alert`,
`issue_new`, `issue_regression`.

## Config

`config.json`, validated with zod. Every field has a default. A bad file keeps the last good config
and writes an error record to the feed.

```json
{
  "coordinator": { "model": "claude-sonnet-5-5", "thinking": "medium" },
  "worker": { "model": "claude-opus-5-5", "thinking": "high" },
  "summaryModel": "haiku",
  "staleAfterMinutes": 120,
  "sources": [
    {
      "type": "github",
      "everySeconds": 60,
      "default": "candidate",
      "rules": [{ "kind": "security_alert", "repo": "owner/repo", "action": "ignore" }]
    },
    {
      "type": "sentry",
      "everySeconds": 300,
      "url": "https://sentry.io",
      "org": "my-org",
      "projects": ["api"],
      "tokenEnv": "SENTRY_AUTH_TOKEN",
      "default": "candidate",
      "rules": []
    }
  ]
}
```

Rule actions: `ignore` (drop it), `candidate` (route it), `mention-only` (route it only when the
event mentions the user or asks for their review, that is the kinds `mention`, `review_requested`,
and `assigned`; else drop it). The first matching rule wins. A rule matches when each field that it
sets is equal to the event field. `repo` matches the `owner/repo` part of a GitHub thread key.
Secrets are never in the config: GitHub uses `gh auth`, other sources name an environment variable.

## Feed

`feed.jsonl` has one JSON record per line:

```ts
{ ts: string; source: string; ok: boolean; new: number;
  routed: { thread: string; kind: string; to: string }[]; ignored: number;
  error?: string; summary: string }
```

`source` is a source type or `factoryd` for daemon actions (respawn, interrupt, config error). `to`
is a terminal name or `inbox`. `summary` is one human sentence. The daemon asks the summary model
for it with
`pi -p --no-session --no-tools --no-extensions --no-skills --no-context-files --no-prompt-templates --model <summaryModel>`
and a 20 second timeout. The model name must resolve without extensions; `haiku` is a pattern that
does. When that fails, it uses a fixed template. It does not call the model for a cycle with
`ok: true` and `new: 0`; the template is enough.

## Terminals

All factory agents are interactive pi in herdr-core terminals. They do not have a parent, so that
they live when other agents stop.

| Terminal              | Name           | cwd             | Session id | Env                                                  |
| --------------------- | -------------- | --------------- | ---------- | ---------------------------------------------------- |
| daemon                | `factoryd`     | repository root | -          | -                                                    |
| coordinator           | `factory`      | `FACTORY_HOME`  | `factory`  | `FACTORY_ROLE=coordinator FACTORY_HOME`              |
| worker of task `<id>` | `factory-<id>` | task `repo`     | `<id>`     | `FACTORY_ROLE=worker FACTORY_TASK=<id> FACTORY_HOME` |

Spawn sets `FACTORY_HOME` to the ledger of the caller, so that agents use the same ledger.

- Start pi with `--session-id <session id>`. Pi then resumes the same session when the reconciler
  starts it again, so a conversation survives a crash. The first start sends the task prompt. A
  restart sends "You were restarted. Read your task file again and continue."
- Put the coordinator in a Herdr space named `factory`. Put each worker in the Herdr space whose
  folder is the task `repo`, in a tab named after the task. Make the space when it does not exist.
  When the Herdr window is not running, start the terminal without Herdr labels.
- Spawn places a terminal with the `herdr.space` and `herdr.tab` labels of `hc run`. The tab id of a
  worker is `tbfactory-<id>`, so a restart goes into the same tab. A new space for a repo has the id
  `spfactory-<hash of the folder>`; the coordinator space has the id `spfactory`. Herdr turns on
  core keep for terminals that it shows, so when pi exits, a shell replaces it. That terminal does
  not run pi, so the reconciler restarts it.
- Spawn ends and removes an old terminal with the same name before it starts the new one.
- Workers start their own sub-agents with `FACTORY_ROLE=subagent`.
- Spawn code lives in `src/core`, because both the coordinator tool `factory_dispatch` and the
  daemon reconciler use it.

## Messages to agents

The daemon sends messages with `hc send`. Each message is one tagged block, so the agent can tell it
from the user:

```
<factory from="factoryd">
- event e-123 gh:helvey/hellstack#88 pr_comment "Please rename x" https://... (task t-7f3a)
- task t-9b21 is ready
</factory>
```

The daemon collects messages for the coordinator and sends at most one block every 30 seconds.

## factoryd

One process per machine, in the `factoryd` terminal. Each loop step is plain code. No step waits on
a model, except the feed summary, which has a timeout.

1. **Poll** each source when its interval passes (or the `X-Poll-Interval` of GitHub, when it is
   longer). Keep cursors and seen ids in `state/`, so that it handles no event two times. The first
   poll of a source looks back one hour. GitHub reads up to 5 pages of 50. Sentry looks back 5
   minutes more than its cursor, because `lastSeen` is the event time; it routes a regression of an
   issue one time. Two sources with the same key (`github`, or `sentry:<org>:<projects>`) make the
   config not valid.
2. **Filter** with the source rules.
3. **Route** each event that passes. Look up the tasks whose `threads` has the event thread.
   - Owned, worker running, not paused: send it to the worker.
   - Owned, otherwise: send it to the coordinator.
   - Not owned: write it to `inbox/` and send it to the coordinator.
   - Remove inbox files whose thread a task now owns.
4. **Reconcile** every 30 seconds. Desired: tasks with status `working` or `landing` and
   `paused: false`. Actual: `hc ls`. Start each worker that is missing or that no longer runs pi,
   with the restart prompt (`factory_dispatch` makes the first start). Tell the coordinator about
   each new `ready` task one time. Tell the coordinator one time when a task has had no `updated`
   change for `staleAfterMinutes` and its worker is not working.
5. **Keepalive**: start the coordinator when its terminal is missing.
6. **Watchdog**: when the coordinator has had the same turn with status `working` for more than 3
   minutes, run `hc interrupt factory` and write a feed record.
7. **Feed**: write one record per poll cycle and per daemon action.

The daemon reloads `config.json` when it changes. The messages for the coordinator are in
`state/daemon.json` until they are sent, so they survive a restart; at most 50 lines wait, and a
line tells how many older lines were dropped. The daemon sends them before it stops. The `factoryd`
terminal runs the daemon in a login shell of the user (`$SHELL -lic`), because `hc run` does not
give the caller's environment to the terminal; the shell files give the tokens. `--no-agents` runs
the loop without agents: it does not start, message, or interrupt agents, and prints the messages
instead.

## Extension

The extension reads `FACTORY_ROLE`. A session can also become `design` with `/sketch`; pi keeps that
in the session with `appendEntry`, so it survives a resume.

| Role          | Prompt sections                                      | Tools                                                                                        |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `coordinator` | `chinchilla.md`, `COORDINATOR.md` (live file), skill | `factory_task`, `factory_inbox`, `factory_dispatch`, `factory_handoff`; bash limited to 10 s |
| `worker`      | `chinchilla.md`, `WORKER.md`, task id and path       | `factory_task` (own task)                                                                    |
| `design`      | `chinchilla.md`, task template guidance, task path   | `factory_task`, `factory_handoff`                                                            |
| `subagent`    | `chinchilla.md`                                      | none                                                                                         |
| none          | nothing                                              | `/sketch` command only                                                                       |

- `factory_task`: `list`, `get`, `create`, `update` (status, now, needs_you, threads, paused,
  title), `log`, `check` (check a landing item by its 1-based number).
- `factory_inbox`: `list`, `dismiss`.
- `factory_dispatch`: start the worker of a `ready` task and set it to `working`.
- `factory_handoff`: validate a `sketch` and set it to `ready`. Return the missing parts when it
  fails.
- Commands: `/sketch <title>` (any session), `/handoff` (design), `/park` and `/unpark` (worker).
- Only the coordinator role loads the `factory` skill.

## Board

A Herdr mod that reads `factory board --json`:

```ts
{ tasks: { id; title; status; repo; needs_you; now; paused; landing: { done; total };
           terminal?: string; working?: boolean }[];
  inbox: number;
  invalid: number;                          // task files that are not valid
  sources: { source; ok; ts; summary }[];   // the last record of each source, factoryd too
  feed: { ts; source; summary }[] }          // the last 20 records
```

It shows "needs you" first (tasks with `needs_you`; a coordinator proposal is a `sketch` with
`needs_you` set), then the columns `sketch`, `ready`, `working`, `landing`, and `landed` (today
only), then the source health and the feed. A click on a task with a terminal focuses that terminal.

## CLI

`bun run factory <command>`:

- `init`: make the ledger (see above). `bun run sync` runs it.
- `up`: start `factoryd` and the coordinator when they do not run. It is safe to run more than once.
- `down`: stop `factoryd` and the coordinator. Workers continue.
- `status`: print what runs and the task counts.
- `daemon [--no-agents]`: run the `factoryd` loop in the foreground. `up` runs it in the `factoryd`
  terminal.
- `board --json`: print the board model.
