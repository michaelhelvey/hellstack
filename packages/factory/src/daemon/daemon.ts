import { setTimeout as delay } from "node:timers/promises";

import {
  appendFeed,
  COORDINATOR_TERMINAL,
  createHc,
  createHerdr,
  defaultConfig,
  listInbox,
  listTasks,
  parseConfig,
  readIfExists,
  removeInbox,
  runCommand,
  startCoordinator,
  startWorker,
  writeInbox,
  type CommandRunner,
  type Config,
  type FactoryEvent,
  type Hc,
  type HcTerminal,
  type Herdr,
  type LedgerPaths,
  type SourceConfig,
  type SpawnDeps,
  type Task,
} from "../core/index.ts";
import { emptyDigest, factoryBlock, flushDigest, queueLines, type Digest } from "./digest.ts";
import { filterEvents } from "./filter.ts";
import { acquireLock } from "./lock.ts";
import { reconcile } from "./reconcile.ts";
import { eventLine, INBOX, ownedInbox, routeEvent, runningPi, type Route } from "./route.ts";
import type { PollResult, Source } from "./source.ts";
import { createSource, sourceKey } from "./sources.ts";
import { loadState, rememberSeen, saveState, unseen, type DaemonState } from "./state.ts";
import { summarize, type FeedFacts } from "./summary.ts";
import { watch, type WatchState } from "./watchdog.ts";

/** The time between two reconcile, keepalive, and watchdog steps, in milliseconds. */
export const HOUSEKEEPING_MS = 30_000;

/** What the daemon uses. Tests and the CLI give their own values. */
export interface DaemonOptions {
  paths: LedgerPaths;
  /** When false, the daemon does not start, message, or interrupt agents. It prints the messages. */
  agents: boolean;
  hc: Hc;
  herdr: Herdr;
  /** Runs the summary model. */
  runner: CommandRunner;
  createSource: (config: SourceConfig) => Source;
  log: (line: string) => void;
  /** The time between two loop steps, in milliseconds. */
  tickMs: number;
}

/** The state of a running daemon. */
export interface Daemon {
  options: DaemonOptions;
  config: Config;
  configText: string | undefined;
  state: DaemonState;
  digest: Digest;
  watch: WatchState | undefined;
  nextPoll: Map<string, number>;
  lastHousekeeping: number;
}

/** Returns the default daemon options for the ledger. */
export function daemonOptions(paths: LedgerPaths, agents: boolean): DaemonOptions {
  return {
    paths,
    agents,
    hc: createHc(),
    herdr: createHerdr(),
    runner: runCommand,
    createSource,
    log: (line) => console.log(line),
    tickMs: 5_000,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function feedAction(daemon: Daemon, summary: string, error?: unknown): Promise<void> {
  const facts = {
    ts: new Date().toISOString(),
    source: "factoryd",
    new: 0,
    routed: [],
    ignored: 0,
  };
  const record =
    error === undefined ? { ...facts, ok: true } : { ...facts, ok: false, error: message(error) };
  await appendFeed({ ...record, summary }, daemon.options.paths);
  daemon.options.log(`factoryd: ${summary}${error === undefined ? "" : ` (${message(error)})`}`);
}

async function guard(daemon: Daemon, step: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    await feedAction(daemon, `The ${step} step failed.`, error).catch(() => undefined);
  }
}

/** Loads the config when `config.json` changed. A bad file keeps the last good config. */
export async function reloadConfig(daemon: Daemon): Promise<void> {
  const text = await readIfExists(daemon.options.paths.config);
  if (text === daemon.configText) return;
  daemon.configText = text;
  try {
    daemon.config = text === undefined ? defaultConfig() : parseConfig(text);
  } catch (error) {
    await feedAction(
      daemon,
      "config.json is not valid; factoryd keeps the last good config.",
      error,
    );
  }
}

async function sendTo(daemon: Daemon, terminal: string, lines: string[]): Promise<void> {
  const block = factoryBlock(lines);
  if (!daemon.options.agents) return daemon.options.log(`[no-agents] to ${terminal}:\n${block}`);
  await daemon.options.hc.send(terminal, block);
}

function linesByTerminal(routes: Route[]): Map<string, string[]> {
  const byTerminal = new Map<string, string[]>();
  for (const route of routes) {
    const to = route.to === INBOX ? COORDINATOR_TERMINAL : route.to;
    byTerminal.set(to, [...(byTerminal.get(to) ?? []), eventLine(route)]);
  }
  return byTerminal;
}

async function sendToWorker(daemon: Daemon, terminal: string, lines: string[]): Promise<void> {
  await sendTo(daemon, terminal, lines).catch(() => {
    daemon.digest = queueLines(
      daemon.digest,
      lines.map((line) => `${line} (worker did not answer)`),
    );
  });
}

async function deliver(daemon: Daemon, events: FactoryEvent[]): Promise<Route[]> {
  const { tasks } = await listTasks(daemon.options.paths);
  const running = runningPi(await daemon.options.hc.ls());
  const routes = events.flatMap((event) => routeEvent(event, tasks, running));
  for (const route of routes.filter((r) => r.to === INBOX))
    await writeInbox(route.event, daemon.options.paths);
  for (const [terminal, lines] of linesByTerminal(routes)) {
    if (terminal === COORDINATOR_TERMINAL) daemon.digest = queueLines(daemon.digest, lines);
    else await sendToWorker(daemon, terminal, lines);
  }
  return routes;
}

async function writeCycle(daemon: Daemon, facts: FeedFacts, titles: string[]): Promise<void> {
  const options = { model: daemon.config.summaryModel, runner: daemon.options.runner };
  const summary = await summarize(facts, titles, options);
  await appendFeed({ ...facts, summary }, daemon.options.paths);
  daemon.options.log(`${facts.source}: ${summary}`);
}

function schedule(daemon: Daemon, source: SourceConfig, now: number, minSeconds = 0): void {
  const seconds = Math.max(source.everySeconds, minSeconds);
  daemon.nextPoll.set(sourceKey(source), now + seconds * 1000);
}

async function remember(
  daemon: Daemon,
  key: string,
  poll: PollResult,
  ids: string[],
): Promise<void> {
  const { cursors, seen } = daemon.state;
  daemon.state = {
    ...daemon.state,
    cursors: { ...cursors, [key]: poll.cursor },
    seen: rememberSeen(seen, ids),
  };
  await saveState(daemon.options.paths, daemon.state);
}

function cycleFacts(source: SourceConfig, fields: Partial<FeedFacts>): FeedFacts {
  return {
    ts: new Date().toISOString(),
    source: source.type,
    ok: true,
    new: 0,
    routed: [],
    ignored: 0,
    ...fields,
  };
}

async function handlePoll(
  daemon: Daemon,
  source: SourceConfig,
  poll: PollResult,
): Promise<FeedFacts> {
  const fresh = unseen(poll.events, daemon.state.seen);
  const { passed, ignored } = filterEvents(source, fresh);
  const routes = await deliver(daemon, passed);
  await remember(
    daemon,
    sourceKey(source),
    poll,
    fresh.map((event) => event.id),
  );
  const routed = routes.map(({ event, to }) => ({ thread: event.thread, kind: event.kind, to }));
  return cycleFacts(source, { new: fresh.length, routed, ignored });
}

function pollSource(
  daemon: Daemon,
  source: SourceConfig,
  now: number,
): Promise<PollResult | Error> {
  const cursor = daemon.state.cursors[sourceKey(source)];
  const poll = daemon.options.createSource(source).poll(cursor, new Date(now));
  return poll.catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  );
}

/** Polls one source, filters and routes its new events, and writes the feed record of the cycle. */
export async function pollCycle(daemon: Daemon, source: SourceConfig, now: number): Promise<void> {
  const poll = await pollSource(daemon, source, now);
  if (poll instanceof Error) {
    schedule(daemon, source, now);
    return writeCycle(daemon, cycleFacts(source, { ok: false, error: poll.message }), []);
  }
  schedule(daemon, source, now, poll.minIntervalSeconds);
  const facts = await handlePoll(daemon, source, poll);
  await writeCycle(
    daemon,
    facts,
    poll.events.slice(0, 20).map((event) => event.title),
  );
}

function spawnDeps({ options }: Daemon): Pick<SpawnDeps, "hc" | "herdr" | "paths"> {
  return { hc: options.hc, herdr: options.herdr, paths: options.paths };
}

async function startWorkers(daemon: Daemon, tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    await guard(daemon, `start of worker ${task.meta.id}`, async () => {
      await startWorker(task, daemon.config, {
        restart: true,
        deps: spawnDeps(daemon),
      });
      await feedAction(daemon, `Started the worker of task ${task.meta.id} again.`);
    });
  }
}

async function keepalive(daemon: Daemon, terminals: HcTerminal[]): Promise<void> {
  if (runningPi(terminals).has(COORDINATOR_TERMINAL)) return;
  await startCoordinator(daemon.config, { restart: true, deps: spawnDeps(daemon) });
  await feedAction(daemon, "Started the coordinator again.");
}

async function watchdog(daemon: Daemon, now: number): Promise<void> {
  const detail = await daemon.options.hc.get(COORDINATOR_TERMINAL);
  const input = { working: detail?.status?.state === "working", turn: detail?.turn ?? 0 };
  const result = watch(daemon.watch, input, now);
  daemon.watch = result.state;
  if (!result.interrupt) return;
  await daemon.options.hc.interrupt(COORDINATOR_TERMINAL);
  await feedAction(
    daemon,
    `Interrupted the coordinator: turn ${input.turn} worked for more than 3 minutes.`,
  );
}

async function removeOwnedInbox(daemon: Daemon, tasks: Task[]): Promise<void> {
  const ids = ownedInbox(await listInbox(daemon.options.paths), tasks);
  for (const id of ids) await removeInbox(id, daemon.options.paths);
}

/**
 * Runs the reconcile, keepalive, and watchdog steps. Without agents, it only removes owned inbox
 * events and queues the notices.
 */
export async function housekeeping(daemon: Daemon, now: number): Promise<void> {
  const { tasks } = await listTasks(daemon.options.paths);
  const terminals = await daemon.options.hc.ls();
  await removeOwnedInbox(daemon, tasks);
  const { staleAfterMinutes } = daemon.config;
  const plan = reconcile({
    tasks,
    terminals,
    notices: daemon.state.notices,
    now: new Date(now),
    staleAfterMinutes,
  });
  daemon.state = { ...daemon.state, notices: plan.notices };
  daemon.digest = queueLines(daemon.digest, plan.notify);
  await saveState(daemon.options.paths, daemon.state);
  if (!daemon.options.agents) return;
  await startWorkers(daemon, plan.start);
  await guard(daemon, "keepalive", () => keepalive(daemon, terminals));
  await guard(daemon, "watchdog", () => watchdog(daemon, now));
}

async function flush(daemon: Daemon, now: number): Promise<void> {
  const { digest, block } = flushDigest(daemon.digest, now);
  if (block === undefined) return;
  const lines = daemon.digest.lines;
  daemon.digest = digest;
  await sendTo(daemon, COORDINATOR_TERMINAL, lines).catch((error: unknown) => {
    daemon.digest = queueLines(daemon.digest, lines);
    throw error;
  });
}

async function pollDue(daemon: Daemon, now: number): Promise<void> {
  const due = daemon.config.sources.filter(
    (source) => (daemon.nextPoll.get(sourceKey(source)) ?? 0) <= now,
  );
  for (const source of due) await guard(daemon, "poll", () => pollCycle(daemon, source, now));
}

/** Runs one loop step: config reload, due polls, housekeeping, and the coordinator digest. */
export async function tick(daemon: Daemon, now: number): Promise<void> {
  await guard(daemon, "config", () => reloadConfig(daemon));
  await pollDue(daemon, now);
  if (now - daemon.lastHousekeeping >= HOUSEKEEPING_MS) {
    daemon.lastHousekeeping = now;
    await guard(daemon, "reconcile", () => housekeeping(daemon, now));
  }
  await guard(daemon, "message", () => flush(daemon, now));
}

/** Makes the state of a daemon from the ledger. */
export async function createDaemon(options: DaemonOptions): Promise<Daemon> {
  return {
    options,
    config: defaultConfig(),
    configText: undefined,
    state: await loadState(options.paths),
    digest: emptyDigest(),
    watch: undefined,
    nextPoll: new Map(),
    lastHousekeeping: Number.NEGATIVE_INFINITY,
  };
}

/** Runs the daemon loop until `signal` aborts. Only one daemon can run for a ledger. */
export async function runDaemon(options: DaemonOptions, signal: AbortSignal): Promise<void> {
  const release = await acquireLock(options.paths);
  const daemon = await createDaemon(options);
  await feedAction(daemon, `factoryd started${options.agents ? "" : " without agents"}.`);
  while (!signal.aborted) {
    await tick(daemon, Date.now());
    await delay(options.tickMs, undefined, { signal }).catch(() => undefined);
  }
  await saveState(options.paths, daemon.state);
  await feedAction(daemon, "factoryd stopped.");
  await release();
}
