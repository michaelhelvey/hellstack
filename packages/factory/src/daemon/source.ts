import type { FactoryEvent } from "../core/index.ts";

/** The poll position of a source. Each source sets its own fields. The daemon keeps it in `state/`. */
export type Cursor = Record<string, string>;

/** The result of one poll. */
export interface PollResult {
  /** The events of the poll. Events that the daemon saw before can be in the list. */
  events: FactoryEvent[];
  /** The cursor for the next poll. */
  cursor: Cursor;
  /** The minimum time before the next poll that the source asks for, in seconds. */
  minIntervalSeconds?: number;
}

/** An event source. Each source type is one file that makes a `Source` from its config. */
export interface Source {
  /** Gets the events since `cursor`. With no cursor, it starts at `now` minus {@link LOOKBACK_MS}. */
  poll(cursor: Cursor | undefined, now: Date): Promise<PollResult>;
}

/** How far back the first poll of a source looks, in milliseconds. */
export const LOOKBACK_MS = 60 * 60 * 1000;

/** Returns the start time of a poll: the cursor value, or `now` minus {@link LOOKBACK_MS}. */
export function pollStart(since: string | undefined, now: Date): string {
  return since || new Date(now.getTime() - LOOKBACK_MS).toISOString();
}

/** Returns `text` on one line, cut to `max` characters. */
export function oneLine(text: string, max = 200): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
