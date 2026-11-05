import {
  eventSourceSchema,
  listInbox,
  removeInbox,
  type FactoryEvent,
  type LedgerPaths,
} from "../core/index.ts";
import type { InboxSources } from "./source.ts";

/** The inbox events that a prune pass removed, and the errors of the sources that failed. */
export interface PruneResult {
  removed: FactoryEvent[];
  errors: string[];
}

/**
 * Returns the event with the detail of its source. When the source fails, the event keeps the
 * detail that the poll set.
 */
export async function withDetail(
  sources: InboxSources,
  event: FactoryEvent,
): Promise<FactoryEvent> {
  const detail = await sources[event.source].detail(event).catch(() => event.detail);
  return detail ? { ...event, detail } : event;
}

/** Returns the inbox event `id`. Throws when the inbox does not have it. */
export async function findInbox(paths: LedgerPaths, id: string): Promise<FactoryEvent> {
  const event = (await listInbox(paths)).find((item) => item.id === id);
  if (!event) throw new Error(`the inbox has no event ${id}`);
  return event;
}

/** Removes all inbox events of `thread`. */
export async function removeThread(paths: LedgerPaths, thread: string): Promise<void> {
  const events = (await listInbox(paths)).filter((event) => event.thread === thread);
  await Promise.all(events.map((event) => removeInbox(event.id, paths)));
}

/**
 * Does the dismiss action of the source of inbox event `id` (for example, it marks the GitHub
 * notification thread done), then removes all inbox events of its thread. When the action fails, it
 * throws and the inbox does not change.
 */
export async function dismissInbox(
  paths: LedgerPaths,
  sources: InboxSources,
  id: string,
): Promise<FactoryEvent> {
  const event = await findInbox(paths, id);
  await sources[event.source].dismiss(event);
  await removeThread(paths, event.thread);
  return event;
}

function errorText(source: string, reason: unknown): string {
  return `${source}: ${reason instanceof Error ? reason.message : String(reason)}`;
}

/**
 * Asks each source which inbox events are done (a merged or closed subject, a resolved issue, a
 * notification that the user marked done) and removes them. A source that fails keeps its events.
 */
export async function pruneInbox(paths: LedgerPaths, sources: InboxSources): Promise<PruneResult> {
  const inbox = await listInbox(paths);
  const types = eventSourceSchema.options;
  const results = await Promise.allSettled(
    types.map((type) => sources[type].isDone(inbox.filter((event) => event.source === type))),
  );
  const done = new Set(
    results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
  );
  const removed = inbox.filter((event) => done.has(event.id));
  await Promise.all(removed.map((event) => removeInbox(event.id, paths)));
  const errors = results.flatMap((result, index) =>
    result.status === "rejected" ? [errorText(types[index] ?? "", result.reason)] : [],
  );
  return { removed, errors };
}
