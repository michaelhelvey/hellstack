import { expect, test } from "bun:test";
import { appendFile } from "node:fs/promises";

import { appendFeed, readFeed, type FeedRecord } from "../../src/core/feed.ts";
import { tempLedger } from "./helpers.ts";

function record(summary: string): FeedRecord {
  const ts = "2026-11-05T15:00:00.000Z";
  return { ts, source: "github", ok: true, new: 0, routed: [], ignored: 0, summary };
}

test("readFeed returns the last records and skips bad lines", async () => {
  const paths = await tempLedger();
  expect(await readFeed(5, paths)).toEqual([]);
  await appendFeed(record("one"), paths);
  await appendFile(paths.feed, "not json\n{}\n");
  await appendFeed(record("two"), paths);
  await appendFeed(record("three"), paths);
  expect((await readFeed(2, paths)).map((r) => r.summary)).toEqual(["two", "three"]);
  expect((await readFeed(10, paths)).map((r) => r.summary)).toEqual(["one", "two", "three"]);
  expect(await readFeed(0, paths)).toEqual([]);
});
