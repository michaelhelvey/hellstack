import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { readIfExists } from "./files.ts";
import { ledgerPaths, type LedgerPaths } from "./paths.ts";

/** One record of the feed: one poll cycle or one daemon action. */
export const feedRecordSchema = z.object({
  ts: z.iso.datetime(),
  source: z.string().min(1),
  ok: z.boolean(),
  new: z.number().int().nonnegative(),
  routed: z.array(z.object({ thread: z.string(), kind: z.string(), to: z.string() })),
  ignored: z.number().int().nonnegative(),
  error: z.string().optional(),
  summary: z.string(),
});

/** One record of the feed. */
export type FeedRecord = z.infer<typeof feedRecordSchema>;

/** Adds `record` as one line at the end of `feed.jsonl`. */
export async function appendFeed(
  record: FeedRecord,
  paths: LedgerPaths = ledgerPaths(),
): Promise<void> {
  const line = JSON.stringify(feedRecordSchema.parse(record));
  await mkdir(dirname(paths.feed), { recursive: true });
  await appendFile(paths.feed, `${line}\n`, "utf8");
}

function parseRecord(line: string): FeedRecord[] {
  try {
    const result = feedRecordSchema.safeParse(JSON.parse(line));
    return result.success ? [result.data] : [];
  } catch {
    return [];
  }
}

/** Returns the last `count` valid records of the feed, oldest first. */
export async function readFeed(
  count: number,
  paths: LedgerPaths = ledgerPaths(),
): Promise<FeedRecord[]> {
  const text = (await readIfExists(paths.feed)) ?? "";
  const records = text.split("\n").filter(Boolean).flatMap(parseRecord);
  return count > 0 ? records.slice(-count) : [];
}
