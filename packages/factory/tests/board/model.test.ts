import { describe, expect, test } from "bun:test";

import { BOARD_FEED_SIZE, buildBoard, type BoardInput } from "../../src/board/model.ts";
import type { FactoryEvent } from "../../src/core/events.ts";
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
    landed_at: null,
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

function minute(i: number): string {
  return new Date(Date.UTC(2026, 10, 5, 0, i)).toISOString();
}

function board(input: Partial<BoardInput>) {
  return buildBoard({ tasks: [], invalid: 0, inbox: [], feed: [], terminals: [], now, ...input });
}

describe("buildBoard tasks", () => {
  test("leaves out dropped tasks and tasks that landed before today", () => {
    const tasks = [
      task("t-0001", { status: "dropped" }),
      task("t-0002", { status: "landed", updated: yesterday }),
      task("t-0003", { status: "landed" }),
      task("t-0004", { status: "sketch", updated: yesterday }),
      task("t-0005", { status: "landed", landed_at: yesterday }),
      task("t-0006", { status: "landed", landed_at: now.toISOString(), updated: yesterday }),
    ];
    expect(board({ tasks }).tasks.map((card) => card.id)).toEqual(["t-0003", "t-0004", "t-0006"]);
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

function event(id: string, ts: string): FactoryEvent {
  return {
    id,
    source: "github",
    thread: `gh:a/b#${id}`,
    kind: "pr_comment",
    title: `title ${id}`,
    summary: "long text",
    url: `https://github.com/a/b/pull/${id}`,
    ts,
  };
}

describe("buildBoard inbox", () => {
  test("the inbox events are newest first, without the summary", () => {
    const inbox = [
      event("1", "2026-11-05T14:00:00.000Z"),
      event("3", "2026-11-05T14:02:00.000Z"),
      event("2", "2026-11-05T14:01:00.000Z"),
    ];
    const items = board({ inbox }).inbox;
    expect(items.map((item) => item.id)).toEqual(["3", "2", "1"]);
    const { summary: _, ...shown } = event("3", "2026-11-05T14:02:00.000Z");
    expect(items[0]).toEqual(shown);
  });
});

describe("buildBoard sources and feed", () => {
  test("the sources are the last record of each source, factoryd too", () => {
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
      ["factoryd", true, "2026-11-05T14:03:00.000Z"],
    ]);
    expect(sources[0]?.summary).toBe("github 2026-11-05T14:02:00.000Z");
  });

  test("the feed has the last records, oldest first", () => {
    const feed = Array.from({ length: BOARD_FEED_SIZE + 5 }, (_, i) =>
      record("github", minute(i), { new: 1 }),
    );
    const items = board({ feed });
    const last = feed.slice(5).map(({ ts, source, summary }) => ({ ts, source, summary }));
    expect(items.feed).toEqual(last);
  });

  test("the feed leaves out empty polls, the sources do not", () => {
    const kept = [
      record("github", minute(0), { new: 1 }),
      record("sentry", minute(1), { routed: [{ thread: "t", kind: "issue", to: "inbox" }] }),
      record("github", minute(2), { ok: false, error: "boom" }),
      record("factoryd", minute(3)),
    ];
    const empty = Array.from({ length: BOARD_FEED_SIZE }, (_, i) =>
      record("github", minute(10 + i)),
    );
    const items = board({ feed: [...kept, ...empty] });
    expect(items.feed.map(({ ts }) => ts)).toEqual(kept.map(({ ts }) => ts));
    expect(items.sources[0]).toMatchObject({ source: "github", ok: true, ts: minute(29) });
  });
});
