import { appendFile, mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { errorCode } from "./files.ts";
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

/** The size of each block that {@link readFeed} reads from the end of the feed. */
export const FEED_CHUNK_BYTES = 64 * 1024;

async function openFeed(path: string): Promise<FileHandle | undefined> {
  return open(path, "r").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
}

async function readBlock(handle: FileHandle, start: number, end: number): Promise<Buffer> {
  const block = Buffer.alloc(end - start);
  await handle.read(block, 0, block.length, start);
  return block;
}

function completeRecords(tail: Buffer, fromStart: boolean): FeedRecord[] {
  const lines = tail.toString("utf8").split("\n");
  return (fromStart ? lines : lines.slice(1)).filter(Boolean).flatMap(parseRecord);
}

function lineBreaks(block: Buffer): number {
  let count = 0;
  for (let at = block.indexOf(10); at !== -1; at = block.indexOf(10, at + 1)) count++;
  return count;
}

function worthParsing(start: number, breaks: number, count: number): boolean {
  return start === 0 || breaks > count;
}

async function readTail(handle: FileHandle, count: number, chunk: number): Promise<FeedRecord[]> {
  let start = (await handle.stat()).size;
  let tail = Buffer.alloc(0);
  let breaks = 0;
  let records: FeedRecord[] = [];
  while (start > 0 && records.length < count) {
    const end = start;
    start = Math.max(0, end - chunk);
    const block = await readBlock(handle, start, end);
    tail = Buffer.concat([block, tail]);
    breaks += lineBreaks(block);
    if (worthParsing(start, breaks, count)) records = completeRecords(tail, start === 0);
  }
  return records.slice(Math.max(0, records.length - count));
}

/**
 * Returns the last `count` valid records of the feed, oldest first. It reads blocks of
 * `chunkBytes` from the end of the file until it has `count` records, so the cost does not grow
 * with the size of the feed.
 */
export async function readFeed(
  count: number,
  paths: LedgerPaths = ledgerPaths(),
  chunkBytes: number = FEED_CHUNK_BYTES,
): Promise<FeedRecord[]> {
  const handle = await openFeed(paths.feed);
  if (!handle) return [];
  try {
    return await readTail(handle, count, chunkBytes);
  } finally {
    await handle.close();
  }
}
