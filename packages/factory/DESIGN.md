# Factory design

This file is the contract between the parts of the factory. Read it before you change a part. Keep
it current when a contract changes.

## Goal

One coordinator agent that the user talks to about all work. It is always unblocked. It shepherds
tasks through workers until each task lands. Code does the deterministic parts. Prose does the rest.
Keep the code small. Do not add process that a capable model does not need.

## Parts

| Part       | Where                                        | Runtime | What it does                                                     |
| ---------- | -------------------------------------------- | ------- | ---------------------------------------------------------------- |
| core       | `src/core/`                                  | Node    | Ledger paths, config, task files, inbox, feed, hc, agent spawn   |
| `factoryd` | `src/daemon/`                                | bun     | Poll, filter, route, reconcile, keepalive, watchdog, prune, feed |
| extension  | `src/index.ts`, `src/extension/`             | Node    | Roles, prompt injection, tools, commands, bash timeout           |
| CLI        | `src/cli.ts`                                 | bun     | `init`, `up`, `down`, `status`, `board`, `open`, `inbox`         |
| prose      | `prompts/`, `skills/factory/`                | -       | `chinchilla.md`, `WORKER.md`, coordinator seed, task template    |
| board      | `packages/herdr/config/mods/factory-board`   | Herdr   | The board mod                                                    |
| layout     | `packages/herdr/config/layouts/factory.json` | Herdr   | The `factory` layout                                             |

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
                     messages that wait for the coordinator), factoryd.pid (the daemon lock),
                     checkouts.json (the local checkout of each GitHub repository).
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
cwd: /Users/me/dev/helvetici/hellstack
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
| `cwd`       | absolute path     | The working directory of the task agents (worker and design agent).   |
| `threads`   | string[]          | Thread keys that the task owns. Events on them go to the task worker. |
| `paused`    | boolean           | When true, the reconciler does not start or restart the worker.       |
| `needs_you` | string or null    | A question for the user. Not null puts the task in "needs you".       |
| `now`       | string            | One line: what happens now.                                           |
| `created`   | ISO time          |                                                                       |
| `updated`   | ISO time          | Every write through core sets it.                                     |
| `landed_at` | ISO time or null  | Core sets it when the status changes to `landed`.                     |

Status values: `sketch`, `ready`, `working`, `landing`, `landed`, `dropped`.

```
sketch → ready → working → landing → landed
  any  → dropped
ready → sketch, landing → working
working → landed   (the landing completes at once, for example a local commit)
```

`updateTask` accepts only these changes (`statusTransitions` in core). `landed` and `dropped` are
final.

- `sketch`: someone works on the contract. Nothing acts on it.
- `ready`: the contract is complete. The coordinator dispatches it.
- `working`, `landing`: a worker owns it. The reconciler keeps the worker running.
- `landed`, `dropped`: done. Nothing acts on it.

**Handoff** is the only way from `sketch` to `ready`. Handoff fails unless Goal, Verification,
Output, and Constraints have text (HTML comments do not count), Landing has at least one checkbox
item, and `cwd` is a folder that exists. Handoff is the same for every source: the user with a
design agent, a coordinator proposal, or a file that someone wrote by hand.

`updateTask` can change `cwd` only while the status is `sketch` or `ready`. A file from before `cwd`
has the field `repo`: core reads it as `cwd` and the next write has `cwd`.

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
  detail?: {
    author?: string;
    body?: string; // plain text, at most 1500 characters
    state?: string; // open, merged, closed, unresolved, resolved, ignored, ...
    repo?: string; // owner/repo, or the Sentry project
  };
}
```

A source can set `detail` when it polls (GitHub: the author and text of the last comment; Sentry:
all of it). Before factoryd writes an event to the inbox, the source completes `detail` (GitHub: the
state of the issue or pull request, and its author and text when there was no comment), so the board
needs no network call.

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
  "closeAfterMinutes": 60,
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
      "org": "my-org",
      "projects": ["api"],
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
Secrets are never in the config: GitHub uses `gh auth`, Sentry uses the login of the `sentry` CLI
(`sentry auth login`). The Sentry source ignores the old fields `url` and `tokenEnv`.

`repoRoots` (default `["~/dev"]`) are the folders where `inbox design` looks for the local checkout
of a GitHub repository: a git checkout whose `origin` remote ends in `owner/repo` (each host, so an
SSH host alias matches), at most 3 folder levels down. It does not look into a checkout or a
worktree. It keeps each result in `state/checkouts.json`.

## Feed

`feed.jsonl` has one JSON record per line:

```ts
{ ts: string; source: string; ok: boolean; new: number;
  routed: { thread: string; kind: string; to: string }[]; ignored: number;
  error?: string; summary: string }
```

`source` is a source type or `factoryd` for daemon actions (respawn, interrupt, prune, config
error). `to` is a terminal name or `inbox`. `summary` is one human sentence. The daemon asks the
summary model for it with
`pi -p --no-session --no-tools --no-extensions --no-skills --no-context-files --no-prompt-templates --model <summaryModel>`
and a 20 second timeout. The model name must resolve without extensions; `haiku` is a pattern that
does. When that fails, it uses a fixed template. It does not call the model for a cycle with
`ok: true` and `new: 0`; the template is enough.

`readFeed(n)` in core reads blocks from the end of the file until it has `n` valid records, so the
cost of a read does not grow with the size of the feed.

## Terminals

All factory agents are interactive pi in herdr-core terminals. They do not have a parent, so that
they live when other agents stop.

| Terminal                    | Name                  | cwd             | Session id    | Env                                                  |
| --------------------------- | --------------------- | --------------- | ------------- | ---------------------------------------------------- |
| daemon                      | `factoryd`            | repository root | -             | -                                                    |
| coordinator                 | `factory`             | `FACTORY_HOME`  | `factory`     | `FACTORY_ROLE=coordinator FACTORY_HOME`              |
| worker of task `<id>`       | `factory-<id>`        | task `cwd`      | `<id>`        | `FACTORY_ROLE=worker FACTORY_TASK=<id> FACTORY_HOME` |
| design agent of task `<id>` | `factory-design-<id>` | task `cwd`      | `design-<id>` | `FACTORY_ROLE=design FACTORY_TASK=<id> FACTORY_HOME` |

Spawn sets `FACTORY_HOME` to the ledger of the caller, so that agents use the same ledger.

- Start pi with `--session-id <session id>`. Pi then resumes the same session when the reconciler
  starts it again, so a conversation survives a crash. The first start sends the task prompt. A
  restart sends "You were restarted. Read your task file again and continue." A design agent always
  gets its first prompt ("... Read it, then help the user write its contract.").
- Both task agents use the `worker` model of the config.
- Put the coordinator in a Herdr space named `factory`. Put each worker and design agent in the
  Herdr space whose folder is the task `cwd`, in a tab with the name `<id> <title>` (40 characters
  at most). Make the space when it does not exist. When the Herdr window is not running, start the
  terminal without Herdr labels.
- Spawn places a terminal with the `herdr.space` and `herdr.tab` labels of `hc run`. The tab id of a
  worker is `tbfactory-<id>`, and of a design agent `tbfactory-design-<id>`, so a restart goes into
  the same tab. A new space for a folder has the id `spfactory-<hash of the folder>`; the
  coordinator space has the id `spfactory`. Herdr turns on core keep for terminals that it shows, so
  when pi exits, a shell replaces it. That terminal does not run pi, so the reconciler restarts it.
- Spawn ends and removes an old terminal with the same name before it starts the new one.
- Workers start their own sub-agents with `FACTORY_ROLE=subagent`.
- Spawn code lives in `src/core`, because the coordinator tool `factory_dispatch`, the daemon
  reconciler, and the CLI use it: `startWorker(task, …)`, `startDesign(task, …)`,
  `startCoordinator(…)`.

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
   poll of a source looks back one hour. GitHub reads up to 5 pages of 50. Sentry runs `sentry api`
   (the `sentry` CLI) and looks back 5 minutes more than its cursor, because `lastSeen` is the event
   time; it routes a regression of an issue one time. Two sources with the same key (`github`, or
   `sentry:<org>:<projects>`) make the config not valid.
2. **Filter** with the source rules.
3. **Route** each event that passes. Look up the tasks whose `threads` has the event thread.
   - Owned, worker running, not paused: send it to the worker.
   - Owned, otherwise: send it to the coordinator.
   - Not owned: write it to `inbox/` with its `detail` (see Events) and send it to the coordinator.
   - Remove inbox files whose thread a task now owns.
4. **Reconcile** every 30 seconds. Desired: tasks with status `working` or `landing` and
   `paused: false`. Actual: `hc ls`. Start each worker that is missing or that no longer runs pi,
   with the restart prompt (`factory_dispatch` makes the first start). Tell the coordinator about
   each new `ready` task one time. Tell the coordinator one time when a task has had no `updated`
   change for `staleAfterMinutes` and its worker is not working. Close the worker terminal and the
   design terminal of each `landed` or `dropped` task (`removeTerminal`) when it has been idle for
   `closeAfterMinutes`, and write a feed record. The idle time starts at the later of the finish
   time (`landed_at`; `updated` for `dropped`) and the last status change of the terminal
   (`status_ms` of `hc get`). A terminal with status `working` stays open, so a worker that the user
   still talks to stays open.
5. **Keepalive**: start the coordinator when its terminal is missing.
6. **Watchdog**: when the coordinator has had the same turn with status `working` for more than 3
   minutes, run `hc interrupt factory` and write a feed record.
7. **Prune** every 5 minutes: ask each source which inbox events are done and remove them. Done is a
   merged or closed pull request or issue (GitHub, one GraphQL call), a notification thread that the
   user marked done (it is not in the notification list), or a resolved or ignored Sentry issue (one
   `sentry api` call for each org). A source that fails keeps its events and the step writes an
   error record. A pass that removed something writes one feed record.
8. **Feed**: write one record per poll cycle and per daemon action.

The daemon reloads `config.json` when it changes. The messages for the coordinator are in
`state/daemon.json` until they are sent, so they survive a restart; at most 50 lines wait, and a
line tells how many older lines were dropped. When `hc send` fails with the kind `unavailable` (the
coordinator is still starting), the lines wait for a later tick and the feed gets no error record.
The daemon sends them before it stops. The `factoryd` terminal runs the daemon in a login shell of
the user (`$SHELL -lic`), because `hc run` does not give the caller's environment to the terminal;
the shell files give the `PATH` of `gh` and `sentry`. `--no-agents` runs the loop without agents: it
does not start, message, interrupt, or close agents, and prints the messages instead.
`--no-coordinator` manages workers but does not start, message, or interrupt the coordinator; use it
to test with a temporary ledger, because terminal names are global on the machine.

## Extension

The extension reads `FACTORY_ROLE` and `FACTORY_TASK`. A design agent gets the `design` role from
them. A session without a role can also become `design` with `/sketch`; pi keeps that in the session
with `appendEntry`, so it survives a resume.

| Role          | Prompt sections                                      | Tools                                                                                        |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `coordinator` | `chinchilla.md`, `COORDINATOR.md` (live file), skill | `factory_task`, `factory_inbox`, `factory_dispatch`, `factory_handoff`; bash limited to 10 s |
| `worker`      | `chinchilla.md`, `WORKER.md`, task id and path       | `factory_task` (own task)                                                                    |
| `design`      | `chinchilla.md`, task template guidance, task path   | `factory_task`, `factory_handoff`                                                            |
| `subagent`    | `chinchilla.md`                                      | none                                                                                         |
| none          | nothing                                              | `/sketch` command only                                                                       |

- `factory_task`: `list`, `get`, `create` (title, cwd), `update` (status, now, needs_you, threads,
  paused, title, cwd), `log`, `check` (check a landing item by its 1-based number).
- `factory_inbox`: `list`, `dismiss`.
- `factory_dispatch`: start the worker of a `ready` task and set it to `working`.
- `factory_handoff`: validate a `sketch` and set it to `ready`. Return the missing parts when it
  fails.
- A worker acts only on its own task: `factory_task` refuses `list`, `create`, and other ids. A
  design session acts on its own task when a call gives no id.
- `update` with an empty `needs_you` clears it (pi drops `null` tool arguments).
- The factory tools are `sequential` in pi, so pi does not run them at the same time as an `edit` of
  the same task file in the same assistant message.
- Commands: `/sketch <title>` (every session that has no `FACTORY_ROLE`; a coordinator, worker,
  design agent, or sub-agent must not lose its role), `/handoff` (design), `/park` and `/unpark`
  (worker).
- The coordinator bash limit is code: a `tool_call` handler sets the bash `timeout` to at most 10
  seconds.
- Only the coordinator role loads the `factory` skill. Its body is also in the coordinator prompt.

## Board

A Herdr mod that reads `factory board --json`:

```ts
{ running: { factoryd: boolean; coordinator: boolean };  // factoryd: its terminal is live;
                                                         // coordinator: it runs pi
  tasks: { id; title; status; cwd; needs_you; now; paused; landing: { done; total };
           agent?: { terminal: string;                   // terminal name
                     role: "design" | "worker";          // the live worker, else the design agent
                     working: boolean } }[];
  inbox: FactoryEvent[];                    // all event fields and detail; newest first
  invalid: number;                          // task files that are not valid
  sources: { source; ok; ts; summary }[];   // the last record of each source in the last
                                            // 2000 records, factoryd too
  feed: { ts; source; summary }[] }          // the last 20 records that are not empty polls
```

An empty poll is a record that is not from `factoryd` and has `ok: true`, `new: 0`, and no `routed`
items; the feed leaves it out, but the source health uses it.

The Herdr layout `factory` shows the shown tab on the left, with a banner over it, and the board as
a sidebar on the right (one third of the window, resizable).

The banner tells who the shown tab talks to. Herdr tab `tbfactory` is the coordinator (accent
`ansi5`): the banner shows the counts of tasks that wait on you, working, landing, ready, and the
inbox. Tab `tbfactory-<id>` is the worker of task `<id>` (accent `ansi6`): the banner shows the task
id, title, cwd, status, landing progress, and `now`, and a button back to the coordinator. The board
shows the card of that task with the same accent. The board gives the banner its tasks, the inbox
count, and its load error through Herdr `shared()`; the banner tells when the board cannot load.

The board shows, from top to bottom: "needs you" (tasks with `needs_you`; a coordinator proposal is
a `sketch` with `needs_you` set), `working` and `landing` as cards with `now` and the landing
progress, `ready` and `sketch` as one line each, the inbox, `landed` (today only, from `landed_at`;
else `updated` for files without it), the source health, and the feed. An empty section is one line.
When the board is 680 px or wider, it has two columns: the tasks on the left; the inbox, the source
health, and the feed on the right.

The inbox joins events of one thread into one row: the kind of the newest event, `repo#n` (or the
Sentry short id), the title, the count, and the age. It shows 15 rows and "+N more". The inbox
counts are counts of threads, with the count of events when it is larger. A click on a row opens its
`url` in the browser. A click on a task with a terminal focuses that terminal. Colors come from the
Herdr theme (`theme()`), so the board follows the theme-picker themes.

## CLI

`bun run factory <command>`:

- `init`: make the ledger (see above). `bun run sync` runs it.
- `up`: start `factoryd` and the coordinator when they do not run. It is safe to run more than once.
- `down`: stop `factoryd` and the coordinator. Workers continue.
- `status`: print what runs and the task counts.
- `daemon [--no-agents] [--no-coordinator]`: run the `factoryd` loop in the foreground. `up` runs it
  in the `factoryd` terminal.
- `board --json`: print the board model.
- `open <task-id> [--json]`: start (when its terminal does not run pi) and focus the agent of the
  task with `herdr-app do agent.focus --terminal <address>`. `sketch`: the design agent. `working`,
  `landing`, `landed`: the worker, with the restart prompt. `ready`: the design agent when it runs,
  else nothing and a `message` (it does not dispatch). `dropped`: an error. Prints
  `{ terminal: string | null, started: boolean, focused: boolean, message? }`; `focused` is false
  when the Herdr window does not run or `agent.focus` fails.
- `inbox dismiss <event-id> [--json]`: the dismiss action of the event source (GitHub:
  `gh api -X DELETE notifications/threads/<thread-id>`, which marks the thread done; Sentry:
  `sentry api organizations/<org>/issues/<shortId>/ -X PUT -F status=resolved`), then remove all
  inbox events of its thread. When the action fails, the inbox does not change. Prints
  `{ ok: true }`.
- `inbox design <event-id> [--json]`: make a `sketch` task from the event (its title, its thread in
  `threads`, a Goal draft that links the event, and `cwd` = the local checkout of its GitHub
  repository (see `repoRoots`), else `FACTORY_HOME`), remove the inbox events of its thread, then
  start and focus the design agent. Prints `{ task, terminal }`.

With `--json`, an error prints `{ ok: false, error }` to stdout and exits with 1.

Each source module in `src/daemon` gives the inbox actions of its source (`InboxSource`):
`detail(event)`, `dismiss(event)`, and `isDone(events)` (one call for many events, so the source can
batch). The daemon and the CLI use them; the CLI has no source logic.
