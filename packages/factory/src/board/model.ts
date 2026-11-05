import type { FactoryEvent } from "../core/events.ts";
import type { FeedRecord } from "../core/feed.ts";
import { isRunningPi, type HcTerminal } from "../core/hc.ts";
import {
  COORDINATOR_TERMINAL,
  DAEMON_TERMINAL,
  taskTerminal,
  type TaskAgentRole,
} from "../core/spawn.ts";
import { landingProgress, type LandingProgress, type Task, type TaskStatus } from "../core/task.ts";

/** The live agent terminal of a task. */
export interface BoardAgent {
  /** The terminal name, for example `factory-t-7f3a` or `factory-design-t-7f3a`. */
  terminal: string;
  role: TaskAgentRole;
  /** True when the agent reports the status `working`. */
  working: boolean;
}

/** One task card on the board. */
export interface BoardTask {
  id: string;
  title: string;
  status: TaskStatus;
  cwd: string;
  needs_you: string | null;
  now: string;
  paused: boolean;
  landing: LandingProgress;
  /** The live worker, else the live design agent. */
  agent?: BoardAgent;
}

/** What runs: the `factoryd` terminal is live, and the coordinator terminal runs pi. */
export interface BoardRunning {
  factoryd: boolean;
  coordinator: boolean;
}

/** The health of one source: its last feed record. */
export interface BoardSource {
  source: string;
  ok: boolean;
  ts: string;
  summary: string;
}

/** One feed line on the board. */
export interface BoardFeedItem {
  ts: string;
  source: string;
  summary: string;
}

/** One inbox event on the board, with its detail. */
export type BoardInboxItem = FactoryEvent;

/** The data that the board mod shows. DESIGN.md (Board) is the contract. */
export interface Board {
  running: BoardRunning;
  tasks: BoardTask[];
  /** The inbox events, newest first. */
  inbox: BoardInboxItem[];
  /** The count of task files that are not valid. */
  invalid: number;
  sources: BoardSource[];
  feed: BoardFeedItem[];
}

/** The ledger state and the live terminals that {@link buildBoard} uses. */
export interface BoardInput {
  tasks: Task[];
  invalid: number;
  inbox: FactoryEvent[];
  feed: FeedRecord[];
  terminals: HcTerminal[];
  now: Date;
}

/** The count of feed records on the board. */
export const BOARD_FEED_SIZE = 20;

function sameLocalDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function onBoard(task: Task, now: Date): boolean {
  if (task.meta.status === "dropped") return false;
  const landed = task.meta.landed_at ?? task.meta.updated;
  return task.meta.status !== "landed" || sameLocalDay(new Date(landed), now);
}

function terminalsByName(terminals: HcTerminal[]): Map<string, HcTerminal> {
  const live = terminals.filter((terminal) => terminal.state === "live" && terminal.name);
  return new Map(live.map((terminal) => [terminal.name ?? "", terminal]));
}

const AGENT_ORDER: readonly TaskAgentRole[] = ["worker", "design"];

function taskAgent(id: string, byName: Map<string, HcTerminal>): BoardAgent | undefined {
  for (const role of AGENT_ORDER) {
    const terminal = byName.get(taskTerminal(role, id));
    if (terminal)
      return { terminal: taskTerminal(role, id), role, working: terminal.status === "working" };
  }
  return undefined;
}

function boardTask(task: Task, byName: Map<string, HcTerminal>): BoardTask {
  const { id, title, status, cwd, needs_you, now, paused } = task.meta;
  const landing = landingProgress(task.body);
  const card: BoardTask = { id, title, status, cwd, needs_you, now, paused, landing };
  const agent = taskAgent(id, byName);
  return agent ? { ...card, agent } : card;
}

function running(byName: Map<string, HcTerminal>): BoardRunning {
  const coordinator = byName.get(COORDINATOR_TERMINAL);
  return {
    factoryd: byName.has(DAEMON_TERMINAL),
    coordinator: coordinator !== undefined && isRunningPi(coordinator),
  };
}

function lastPerSource(feed: FeedRecord[]): BoardSource[] {
  const last = new Map<string, FeedRecord>();
  for (const record of feed) last.set(record.source, record);
  return [...last.values()].map(({ source, ok, ts, summary }) => ({ source, ok, ts, summary }));
}

function onFeed(record: FeedRecord): boolean {
  if (record.source === "factoryd" || !record.ok) return true;
  return record.new > 0 || record.routed.length > 0;
}

function newestFirst(inbox: FactoryEvent[]): BoardInboxItem[] {
  return [...inbox].sort((a, b) => b.ts.localeCompare(a.ts));
}

/**
 * Returns the board model. It leaves out dropped tasks and tasks that did not land today (local
 * time, from `landed_at`, else `updated`). `feed` must be in file order; the sources use all of
 * it, the feed only the last records that are not empty polls.
 */
export function buildBoard(input: BoardInput): Board {
  const byName = terminalsByName(input.terminals);
  return {
    running: running(byName),
    tasks: input.tasks
      .filter((task) => onBoard(task, input.now))
      .map((task) => boardTask(task, byName)),
    inbox: newestFirst(input.inbox),
    invalid: input.invalid,
    sources: lastPerSource(input.feed),
    feed: input.feed
      .filter(onFeed)
      .slice(-BOARD_FEED_SIZE)
      .map(({ ts, source, summary }) => ({ ts, source, summary })),
  };
}
