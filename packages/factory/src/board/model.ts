import type { FeedRecord } from "../core/feed.ts";
import type { HcTerminal } from "../core/hc.ts";
import { workerTerminal } from "../core/spawn.ts";
import { landingProgress, type LandingProgress, type Task, type TaskStatus } from "../core/task.ts";

/** One task card on the board. */
export interface BoardTask {
  id: string;
  title: string;
  status: TaskStatus;
  repo: string;
  needs_you: string | null;
  now: string;
  paused: boolean;
  landing: LandingProgress;
  /** The address of the live worker terminal. */
  terminal?: string;
  /** True when the worker reports the agent status `working`. */
  working?: boolean;
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

/** The data that the board mod shows. DESIGN.md (Board) is the contract. */
export interface Board {
  tasks: BoardTask[];
  inbox: number;
  /** The count of task files that are not valid. */
  invalid: number;
  sources: BoardSource[];
  feed: BoardFeedItem[];
}

/** The ledger state and the live terminals that {@link buildBoard} uses. */
export interface BoardInput {
  tasks: Task[];
  invalid: number;
  inbox: number;
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

function boardTask(task: Task, terminal: HcTerminal | undefined): BoardTask {
  const { id, title, status, repo, needs_you, now, paused } = task.meta;
  const landing = landingProgress(task.body);
  const card: BoardTask = { id, title, status, repo, needs_you, now, paused, landing };
  if (!terminal) return card;
  return { ...card, terminal: terminal.address, working: terminal.status === "working" };
}

function lastPerSource(feed: FeedRecord[]): BoardSource[] {
  const last = new Map<string, FeedRecord>();
  for (const record of feed) last.set(record.source, record);
  return [...last.values()].map(({ source, ok, ts, summary }) => ({ source, ok, ts, summary }));
}

/**
 * Returns the board model. It leaves out dropped tasks and tasks that did not land today (local
 * time, from `landed_at`, else `updated`). `feed` must be in file order; the sources use all of
 * it, the feed only the last records.
 */
export function buildBoard(input: BoardInput): Board {
  const byName = terminalsByName(input.terminals);
  return {
    tasks: input.tasks
      .filter((task) => onBoard(task, input.now))
      .map((task) => boardTask(task, byName.get(workerTerminal(task.meta.id)))),
    inbox: input.inbox,
    invalid: input.invalid,
    sources: lastPerSource(input.feed),
    feed: input.feed
      .slice(-BOARD_FEED_SIZE)
      .map(({ ts, source, summary }) => ({ ts, source, summary })),
  };
}
