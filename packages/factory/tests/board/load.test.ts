import { expect, test } from "bun:test";

import { loadBoard } from "../../src/board/load.ts";
import { appendFeed } from "../../src/core/feed.ts";
import { createHc } from "../../src/core/hc.ts";
import { writeInbox } from "../../src/core/inbox.ts";
import { createTask, updateTask } from "../../src/core/ledger.ts";
import type { LedgerPaths } from "../../src/core/paths.ts";
import { tempLedger } from "../core/helpers.ts";

const ts = "2026-11-05T14:00:00.000Z";

async function fillLedger(paths: LedgerPaths): Promise<string> {
  const dropped = await createTask({ title: "Dropped", repo: paths.home }, paths);
  await updateTask(dropped.meta.id, { status: "dropped" }, paths);
  const kept = await createTask({ title: "Kept", repo: paths.home }, paths);
  const event = { source: "github", thread: "gh:a/b#1", kind: "mention", title: "" } as const;
  await writeInbox({ ...event, id: "e-1", summary: "", url: "", ts }, paths);
  const record = { ts, source: "github", ok: true, new: 0, routed: [], ignored: 0 };
  await appendFeed({ ...record, summary: "quiet" }, paths);
  return kept.meta.id;
}

test("loadBoard reads tasks, inbox, feed, and terminals", async () => {
  const paths = await tempLedger();
  const id = await fillLedger(paths);
  const terminals = [{ address: "t9", name: `factory-${id}`, cwd: "/", state: "live", turn: 0 }];
  const stdout = JSON.stringify({ terminals });
  const hc = createHc(() => Promise.resolve({ code: 0, stdout, stderr: "" }));

  const board = await loadBoard(paths, hc);

  expect(board.tasks.map((card) => [card.id, card.terminal])).toEqual([[id, "t9"]]);
  expect(board.inbox).toBe(1);
  expect(board.sources.map((source) => source.summary)).toEqual(["quiet"]);
  expect(board.feed).toEqual([{ ts, source: "github", summary: "quiet" }]);
});

test("loadBoard shows no terminals when hc fails", async () => {
  const paths = await tempLedger();
  await createTask({ title: "Board", repo: paths.home }, paths);
  const hc = createHc(() => Promise.reject(new Error("hc is not installed")));
  const board = await loadBoard(paths, hc);
  expect(board.tasks).toHaveLength(1);
  expect(board.tasks[0]?.terminal).toBeUndefined();
});
