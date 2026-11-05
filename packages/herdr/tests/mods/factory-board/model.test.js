import { describe, expect, test } from "bun:test";

import { coordinatorPlacement, workerPlacement } from "../../../../factory/src/core/herdr.ts";
import { COORDINATOR_TERMINAL, workerTerminal } from "../../../../factory/src/core/spawn.ts";
import {
  EXCERPT_CHARS,
  INBOX_LIMIT,
  age,
  bannerData,
  bySource,
  cliCommand,
  excerpt,
  folderName,
  inboxCount,
  inboxPage,
  inboxThreads,
  kindLabel,
  ledgerChanged,
  openable,
  parseBoard,
  progress,
  repoRoot,
  sections,
  sharedKey,
  shownRole,
  sourceCounts,
  summary,
  tabTerminalNames,
  threadLabel,
  tildePath,
  withoutGone,
} from "../../../config/mods/factory-board/model.js";

function task(id, fields = {}) {
  return {
    id,
    title: id,
    status: "working",
    cwd: "/dev/hellstack",
    needs_you: null,
    now: "",
    paused: false,
    landing: { done: 2, total: 5 },
    ...fields,
  };
}

function event(id, thread, fields = {}) {
  const url = `https://github.com/x/${id}`;
  return { id, source: "github", kind: "pr_comment", thread, title: id, url, ts: "", ...fields };
}

describe("sections", () => {
  test("a task with a question shows only in needs you; the others go to their group", () => {
    const tasks = [
      task("a", { status: "sketch", needs_you: "take this proposal?" }),
      task("b", { status: "ready" }),
      task("c", { status: "landed" }),
      task("d", { status: "working", needs_you: "which API?" }),
      task("e", { status: "working" }),
    ];
    const { needsYou, groups } = sections({ tasks });
    expect(needsYou.map((t) => t.id)).toEqual(["a", "d"]);
    expect(groups.map((g) => [g.status, g.size, g.tasks.map((t) => t.id)])).toEqual([
      ["working", "full", ["e"]],
      ["landing", "full", []],
      ["ready", "line", ["b"]],
      ["sketch", "line", []],
      ["landed", "line", ["c"]],
    ]);
  });
});

describe("inbox", () => {
  test("events of one thread join into one row with the newest event and the count", () => {
    const inbox = [
      event("3", "gh:a/b#1", { kind: "review" }),
      event("2", "gh:a/c#2"),
      event("1", "gh:a/b#1"),
    ];
    expect(inboxThreads(inbox)).toEqual([
      { key: "gh:a/b#1", latest: inbox[0], older: [inbox[2]], count: 2, ids: ["3", "1"] },
      { key: "gh:a/c#2", latest: inbox[1], older: [], count: 1, ids: ["2"] },
    ]);
  });

  test("the source filter and its counts use threads, not events", () => {
    const threads = inboxThreads([
      event("1", "gh:a/b#1"),
      event("2", "sentry:a/X-1", { source: "sentry" }),
      event("3", "gh:a/b#1"),
      event("4", "gh:a/c#2"),
    ]);
    expect(sourceCounts(threads)).toEqual([
      ["github", 2],
      ["sentry", 1],
    ]);
    expect(bySource(threads, "sentry").map((thread) => thread.key)).toEqual(["sentry:a/X-1"]);
    expect(bySource(threads, "")).toHaveLength(3);
  });

  test("dismissed and designed events leave the inbox before the next load", () => {
    const inbox = [event("1", "gh:a/b#1"), event("2", "gh:a/b#1"), event("3", "gh:a/c#2")];
    expect(withoutGone(inbox, new Set(["1", "2"])).map((item) => item.id)).toEqual(["3"]);
  });

  test("a long body shows an excerpt until it is opened", () => {
    const long = "x".repeat(EXCERPT_CHARS + 10);
    expect(excerpt(long, false)).toEqual({ text: `${"x".repeat(EXCERPT_CHARS)}…`, cut: true });
    expect(excerpt(long, true)).toEqual({ text: long, cut: false });
    expect(excerpt("  short  ", false)).toEqual({ text: "short", cut: false });
    expect(excerpt(undefined, false)).toEqual({ text: "", cut: false });
  });

  test("the inbox count is the count of threads, with the events when there are more", () => {
    const one = [event("1", "gh:a/b#1"), event("2", "gh:a/c#2")];
    expect(inboxCount(one)).toBe("2");
    expect(inboxCount([...one, event("3", "gh:a/b#1")])).toBe("2 · 3 events");
    const running = { factoryd: true, coordinator: false };
    const board = { tasks: [], inbox: [...one, event("3", "gh:a/b#1")], running };
    expect(bannerData(board, "x")).toEqual({ tasks: [], inbox: 2, running, error: "x" });
  });

  test("a closed inbox shows the first threads and counts the rest", () => {
    const threads = Array.from({ length: INBOX_LIMIT + 4 }, (_, i) => ({ latest: i, count: 1 }));
    const closed = inboxPage(threads, false);
    expect([closed.shown.length, closed.more]).toEqual([INBOX_LIMIT, 4]);
    const open = inboxPage(threads, true);
    expect([open.shown.length, open.more]).toEqual([INBOX_LIMIT + 4, 0]);
  });

  test("thread keys become short labels", () => {
    expect(threadLabel("gh:transport4/midstream-insights#332")).toBe("midstream-insights#332");
    expect(threadLabel("gh:transport4/gateway")).toBe("gateway");
    expect(threadLabel("sentry:transport4/API-3K1")).toBe("API-3K1");
    expect(threadLabel("task:t-1234")).toBe("t-1234");
  });

  test("known kinds get a short label; other kinds lose the underscores", () => {
    expect(kindLabel("review_requested")).toBe("review?");
    expect(kindLabel("issue_regression")).toBe("regressed");
    expect(kindLabel("deploy_failed")).toBe("deploy failed");
  });

  test("only absolute http and https URLs open in the browser", () => {
    expect(openable("https://github.com/a/b/pull/1")).toBe(true);
    expect(openable("http://localhost:3000/x")).toBe(true);
    expect(openable("")).toBe(false);
    expect(openable("file:///etc/passwd")).toBe(false);
    expect(openable("https://")).toBe(false);
  });
});

describe("banner", () => {
  test("the roles come from the tab ids that factory spawn gives", async () => {
    const coordinator = coordinatorPlacement([]).labels["herdr.tab"];
    const task = { id: "t-1a2b3c", repo: "/tmp", cwd: "/tmp", tabName: "x" };
    const worker = (await workerPlacement([], task)).labels["herdr.tab"];
    expect(shownRole(coordinator)).toEqual({ role: "coordinator" });
    expect(shownRole(worker)).toEqual({ role: "worker", id: "t-1a2b3c" });
  });

  test("the terminal names in the tab tell the role before the tab id", () => {
    expect(shownRole("tb1", [undefined, COORDINATOR_TERMINAL])).toEqual({ role: "coordinator" });
    expect(shownRole("tb1", ["zsh", workerTerminal("t-9")])).toEqual({ role: "worker", id: "t-9" });
    expect(shownRole("tbfactory-t-9", ["factory-design-t-9"])).toEqual({
      role: "design",
      id: "t-9",
    });
    expect(shownRole("tb1", ["zsh"])).toEqual({ role: "other" });
  });

  test("the names of a tab come from its panes and the live terminals", () => {
    const panes = [
      { tab: "tb1", terminal: "t1" },
      { tab: "tb2", terminal: "t2" },
      { tab: "tb1", terminal: null },
    ];
    const terminals = [
      { address: "t1", name: "factory-t-1" },
      { address: "t2", name: "factory" },
    ];
    expect(tabTerminalNames("tb1", panes, terminals)).toEqual(["factory-t-1", undefined]);
  });

  test("the tab id tells the coordinator, a worker, or another tab", () => {
    expect(shownRole("tbfactory")).toEqual({ role: "coordinator" });
    expect(shownRole("tbfactory-t-894203")).toEqual({ role: "worker", id: "t-894203" });
    expect(shownRole("tb8d0c48b98")).toEqual({ role: "other" });
    expect(shownRole(undefined)).toEqual({ role: "other" });
  });

  test("the summary has the counts that are not zero, needs you first", () => {
    const tasks = [task("a", { needs_you: "ok?" }), task("b"), task("c", { status: "ready" })];
    expect(summary({ tasks, inbox: 0 })).toEqual(["1 waiting on you", "2 working", "1 ready"]);
    expect(summary({ tasks: [], inbox: 3 })).toEqual(["3 in the inbox"]);
  });

  test("a board with its own ledger uses its own shared key", () => {
    expect(sharedKey("")).toBe("factory-board");
    expect(sharedKey("/tmp/f")).not.toBe(sharedKey(""));
    expect(sharedKey("/tmp/f")).not.toBe(sharedKey("/tmp/g"));
  });
});

describe("card text", () => {
  test("only working and landing tasks with landing items show progress", () => {
    expect(progress(task("a"))).toBe("2/5");
    expect(progress(task("a", { status: "landing" }))).toBe("2/5");
    expect(progress(task("a", { status: "ready" }))).toBe("");
    expect(progress(task("a", { landing: { done: 0, total: 0 } }))).toBe("");
  });

  test("the space of a task is its last folder; the hover path uses ~", () => {
    expect(folderName("/Users/me/dev/hellstack/")).toBe("hellstack");
    expect(folderName("/")).toBe("/");
    expect(tildePath("/Users/me/dev/x", "/Users/me")).toBe("~/dev/x");
    expect(tildePath("/Users/meme/x", "/Users/me")).toBe("/Users/meme/x");
  });

  test("age uses the largest whole unit", () => {
    const now = Date.parse("2026-11-05T15:00:00.000Z");
    expect(age("2026-11-05T14:59:48.000Z", now)).toBe("12s");
    expect(age("2026-11-05T14:57:00.000Z", now)).toBe("3m");
    expect(age("2026-11-05T12:30:00.000Z", now)).toBe("2h");
    expect(age("2026-11-07T00:00:00.000Z", now)).toBe("0s");
  });
});

describe("loading", () => {
  test("the repository is five folders above the mod folder", () => {
    expect(repoRoot("/dev/hellstack/packages/herdr/config/mods/factory-board")).toBe(
      "/dev/hellstack",
    );
  });

  test("the command sets FACTORY_HOME only when the props give one", () => {
    const cli = "/r/packages/factory/src/cli.ts";
    expect(cliCommand("/r", "", ["board", "--json"])).toEqual(["bun", [cli, "board", "--json"]]);
    expect(cliCommand("/r", "/tmp/f", ["up"])).toEqual([
      "env",
      ["FACTORY_HOME=/tmp/f", "bun", cli, "up"],
    ]);
  });

  test("missing fields in the output get the empty values", () => {
    expect(parseBoard('{"invalid":2}')).toEqual({
      running: null,
      tasks: [],
      inbox: [],
      invalid: 2,
      sources: [],
      feed: [],
    });
  });

  test("output that the board cannot show is an error, not a render crash", () => {
    const { landing: _, ...noLanding } = task("a");
    expect(parseBoard(JSON.stringify({ tasks: [task("a")] })).tasks).toHaveLength(1);
    expect(() => parseBoard(JSON.stringify({ tasks: [noLanding] }))).toThrow("unknown shape");
    expect(() => parseBoard('{"tasks":null}')).toThrow("unknown shape");
    expect(() => parseBoard('{"inbox":8}')).toThrow("unknown shape");
    const { url: _url, ...noUrl } = event("1", "gh:a/b#1");
    expect(() => parseBoard(JSON.stringify({ inbox: [noUrl] }))).toThrow("unknown shape");
    const badDetail = event("1", "gh:a/b#1", { detail: "text" });
    expect(() => parseBoard(JSON.stringify({ inbox: [badDetail] }))).toThrow("unknown shape");
  });

  test("old output with repo and terminal gets cwd and a worker agent", () => {
    const { cwd: _, ...old } = task("a", { repo: "/dev/x", terminal: "t3", working: true });
    const [parsed] = parseBoard(JSON.stringify({ tasks: [old] })).tasks;
    expect(parsed.cwd).toBe("/dev/x");
    expect(parsed.agent).toEqual({ terminal: "t3", role: "worker", working: true });
  });

  test("the fixture boards have the shape that the board shows", async () => {
    for (const name of ["board.json", "board-stopped.json"]) {
      const board = parseBoard(await Bun.file(`${import.meta.dir}/fixtures/${name}`).text());
      expect(board.inbox.length).toBeGreaterThan(10);
      expect(new Set(board.tasks.map((task) => task.status)).size).toBe(5);
    }
  });

  test("only task, inbox, feed, and ledger folder changes load the board again", () => {
    const ledger = "/home/me/.factory";
    expect(
      ledgerChanged([`${ledger}/state/cursors.json`, `${ledger}/tasks/t-1.md.lock`], ledger),
    ).toBe(false);
    expect(ledgerChanged([`${ledger}/tasks/t-1.md.123.ab.tmp`], ledger)).toBe(false);
    expect(ledgerChanged([`${ledger}/tasks/t-1.md`], ledger)).toBe(true);
    expect(ledgerChanged([`${ledger}/inbox/e-1.json`], ledger)).toBe(true);
    expect(ledgerChanged([`${ledger}/feed.jsonl`], ledger)).toBe(true);
    expect(ledgerChanged([`/private${ledger}/`], ledger)).toBe(true);
  });
});
