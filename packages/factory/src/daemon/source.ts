import {
  MAX_DETAIL_BODY,
  type EventDetail,
  type FactoryEvent,
  type FactoryEventSource,
} from "../core/index.ts";

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

/**
 * What factoryd and the CLI do with the inbox events of one source type. Each source module makes
 * its own.
 */
export interface InboxSource {
  /** Returns the detail of an event for the inbox. It completes the `detail` that the poll set. */
  detail(event: FactoryEvent): Promise<EventDetail | undefined>;
  /** Does the dismiss action of the source for the event. Throws when it fails. */
  dismiss(event: FactoryEvent): Promise<void>;
  /**
   * Returns the ids of the events whose subject is done. It checks all events with few calls. An
   * event that it cannot check is not done.
   */
  isDone(events: FactoryEvent[]): Promise<string[]>;
}

/** The {@link InboxSource} of each source type. */
export type InboxSources = Record<FactoryEventSource, InboxSource>;

/**
 * Returns a plain text excerpt of Markdown or HTML text: without HTML comments and tags, without
 * runs of empty lines, and cut to {@link MAX_DETAIL_BODY} characters.
 */
export function excerpt(text: string): string {
  const plain = text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain.length > MAX_DETAIL_BODY ? `${plain.slice(0, MAX_DETAIL_BODY - 1)}…` : plain;
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
