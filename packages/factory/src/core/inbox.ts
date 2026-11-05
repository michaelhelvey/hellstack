import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { eventSchema, type FactoryEvent } from "./events.ts";
import { errorCode, writeAtomic } from "./files.ts";
import { inboxPath, ledgerPaths, type LedgerPaths } from "./paths.ts";

/** Writes `event` to the inbox. An event with the same id is replaced. */
export async function writeInbox(
  event: FactoryEvent,
  paths: LedgerPaths = ledgerPaths(),
): Promise<void> {
  const parsed = eventSchema.parse(event);
  await mkdir(paths.inbox, { recursive: true });
  await writeAtomic(inboxPath(paths, parsed.id), `${JSON.stringify(parsed, null, 2)}\n`);
}

async function readEvent(path: string): Promise<FactoryEvent[]> {
  const result = eventSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  return result.success ? [result.data] : [];
}

/** Returns the inbox events, oldest first. It skips files that are not valid events. */
export async function listInbox(paths: LedgerPaths = ledgerPaths()): Promise<FactoryEvent[]> {
  const names = await readdir(paths.inbox).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  });
  const files = names
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(paths.inbox, name));
  const events = (await Promise.all(files.map((file) => readEvent(file).catch(() => [])))).flat();
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Removes inbox event `id`. It does nothing when the event is not in the inbox. */
export async function removeInbox(id: string, paths: LedgerPaths = ledgerPaths()): Promise<void> {
  await rm(inboxPath(paths, id), { force: true });
}
