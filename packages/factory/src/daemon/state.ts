import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { readIfExists, writeAtomic, type FactoryEvent, type LedgerPaths } from "../core/index.ts";

/** The daemon state that lives through a restart. */
export const daemonStateSchema = z.object({
  cursors: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  seen: z.array(z.string()).default([]),
  notices: z.array(z.string()).default([]),
});

/** The daemon state that lives through a restart. */
export type DaemonState = z.infer<typeof daemonStateSchema>;

/** The maximum count of event ids that the state keeps. */
export const MAX_SEEN = 5000;

/** Returns the path of the daemon state file. */
export function statePath(paths: LedgerPaths): string {
  return join(paths.state, "daemon.json");
}

/** Reads the daemon state. Returns an empty state when the file does not exist. */
export async function loadState(paths: LedgerPaths): Promise<DaemonState> {
  const text = await readIfExists(statePath(paths));
  return daemonStateSchema.parse(text === undefined ? {} : JSON.parse(text));
}

/** Writes the daemon state atomically. */
export async function saveState(paths: LedgerPaths, state: DaemonState): Promise<void> {
  await mkdir(paths.state, { recursive: true });
  await writeAtomic(statePath(paths), `${JSON.stringify(state)}\n`);
}

/** Returns the events whose ids are not in `seen`, each id one time. */
export function unseen(events: FactoryEvent[], seen: string[]): FactoryEvent[] {
  const known = new Set(seen);
  return events.filter((event) => {
    if (known.has(event.id)) return false;
    known.add(event.id);
    return true;
  });
}

/** Returns `seen` with `ids` added. It keeps the newest {@link MAX_SEEN} ids. */
export function rememberSeen(seen: string[], ids: string[]): string[] {
  return [...seen, ...ids].slice(-MAX_SEEN);
}
