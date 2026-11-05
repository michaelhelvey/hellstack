import { describe, expect, test } from "bun:test";

import { BOARD_FEED_SIZE, buildBoard, type BoardInput } from "../../src/board/model.ts";
import type { FeedRecord } from "../../src/core/feed.ts";
import type { HcTerminal } from "../../src/core/hc.ts";
import type { Task, TaskMeta } from "../../src/core/task.ts";
import { completeBody } from "../core/helpers.ts";

const now = new Date(2026, 10, 5, 15, 0);
const yesterday = new Date(2026, 10, 4, 15, 0).toISOString();

function task(id: string, meta: Partial<TaskMeta> = {}): Task {
  const base: TaskMeta = {
    id,
    title: `task ${id}`,
    status: "working",
    repo: "/repo/hellstack",
    threads: [],
    paused: false,
    needs_you: null,
    now: "",
    created: now.toISOString(),
    updated: now.toISOString(),
  };
  return { meta: { ...base, ...meta }, body: completeBody };
}

function terminal(name: string, fields: Partial<HcTerminal> = {}): HcTerminal {
  return { address: `t-${name}`, name, cwd: "/", state: "live", turn: 1, ...fields };
}

function record(source: string, ts: string, fields: Partial<FeedRecord> = {}): FeedRecord {
  return {
    ts,
    source,
    ok: true,
    new: 0,
    routed: [],
    ignored: 0,
    summary: `${source} ${ts}`,
    ...fields,
  };
}

function board(input: Partial<BoardInput>) {
  return buildBoard({ tasks: [], inbox: 0, feed: [], terminals: [], now, ...input });
}

describe("buildBoard tasks", () => {
  test("leaves out dropped tasks and tasks that landed before today", () => {
    const tasks = [
      task("t-0001", { status: "dropped" }),
      task("t-0002", { status: "landed", updated: yesterday }),
      task("t-0003", { status: "landed" }),
      task("t-0004", { status: "sketch", updated: yesterday }),
    ];
    expect(board({ tasks }).tasks.map((card) => card.id)).toEqual(["t-0003", "t-0004"]);
  });

  test("a card has the landing progress and the fields of the front matter", () => {
    const meta = { needs_you: "merge it?", now: "waiting on CI", paused: true };
    const [card] = board({ tasks: [task("t-0001", meta)] }).tasks;
    expect(card).toEqual({
      id: "t-0001",
      title: "task t-0001",
      status: "working",
      repo: "/repo/hellstack",
      ...meta,
      landing: { done: 1, total: 2 },
    });
  });

  test("a card gets the address of the live worker terminal and its agent status", () => {
    const tasks = [task("t-0001"), task("t-0002"), task("t-0003")];
    const terminals = [
      terminal("factory-t-0001", { status: "working" }),
      terminal("factory-t-0002", { status: "idle" }),
      terminal("factory-t-0003", { state: "exited" }),
      terminal("factory"),
    ];
    const cards = board({ tasks, terminals }).tasks;
    expect(cards.map(({ terminal, working }) => ({ terminal, working }))).toEqual([
      { terminal: "t-factory-t-0001", working: true },
      { terminal: "t-factory-t-0002", working: false },
      { terminal: undefined, working: undefined },
    ]);
  });
});

describe("buildBoard sources and feed", () => {
  test("the sources are the last record of each event source", () => {
    const feed = [
      record("github", "2026-11-05T14:00:00.000Z", { ok: false }),
      record("sentry", "2026-11-05T14:01:00.000Z", { ok: false }),
      record("github", "2026-11-05T14:02:00.000Z"),
      record("factoryd", "2026-11-05T14:03:00.000Z"),
    ];
    const { sources } = board({ feed });
    expect(sources.map(({ source, ok, ts }) => [source, ok, ts])).toEqual([
      ["github", true, "2026-11-05T14:02:00.000Z"],
      ["sentry", false, "2026-11-05T14:01:00.000Z"],
    ]);
    expect(sources[0]?.summary).toBe("github 2026-11-05T14:02:00.000Z");
  });

  test("the feed has the last records, oldest first", () => {
    const feed = Array.from({ length: BOARD_FEED_SIZE + 5 }, (_, i) =>
      record("github", new Date(Date.UTC(2026, 10, 5, 0, i)).toISOString()),
    );
    const items = board({ feed, inbox: 3 });
    expect(items.inbox).toBe(3);
    const last = feed.slice(5).map(({ ts, source, summary }) => ({ ts, source, summary }));
    expect(items.feed).toEqual(last);
  });
});
