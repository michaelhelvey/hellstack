import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FactoryEvent } from "../../src/core/events.ts";
import { listInbox, removeInbox, writeInbox } from "../../src/core/inbox.ts";
import { tempLedger } from "./helpers.ts";

function event(id: string, ts: string): FactoryEvent {
  return {
    id,
    source: "github",
    thread: "gh:helvey/hellstack#88",
    kind: "pr_comment",
    title: "Please rename x",
    summary: "",
    url: "https://example.com",
    ts,
  };
}

test("the inbox writes, lists by time, and removes events", async () => {
  const paths = await tempLedger();
  expect(await listInbox(paths)).toEqual([]);
  const later = event("e-2", "2026-11-05T15:00:00.000Z");
  const earlier = event("e-1", "2026-11-05T14:00:00.000Z");
  await writeInbox(later, paths);
  await writeInbox(earlier, paths);
  await writeFile(join(paths.inbox, "junk.json"), "{}");
  expect(await listInbox(paths)).toEqual([earlier, later]);
  await removeInbox("e-1", paths);
  await removeInbox("e-1", paths);
  expect(await listInbox(paths)).toEqual([later]);
});

test("writeInbox rejects an id that is not a safe file name", async () => {
  const paths = await tempLedger();
  const error = await writeInbox(event("../x", "2026-11-05T14:00:00.000Z"), paths).catch(String);
  expect(error).toContain("invalid_format");
});
