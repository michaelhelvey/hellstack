import { describe, expect, test } from "bun:test";
import {
  age,
  boardCommand,
  ledgerChanged,
  parseBoard,
  progress,
  repoName,
  repoRoot,
  sections,
} from "../../../config/mods/factory-board/model.js";

function task(id, fields = {}) {
  return {
    id,
    title: id,
    status: "working",
    repo: "/dev/hellstack",
    needs_you: null,
    now: "",
    paused: false,
    landing: { done: 2, total: 5 },
    ...fields,
  };
}

describe("sections", () => {
  test("a task with a question shows only in needs you; the others go to their column", () => {
    const tasks = [
      task("a", { status: "sketch", needs_you: "take this proposal?" }),
      task("b", { status: "ready" }),
      task("c", { status: "landed" }),
      task("d", { status: "working", needs_you: "which API?" }),
      task("e", { status: "working" }),
    ];
    const { needsYou, columns } = sections({ tasks });
    expect(needsYou.map((t) => t.id)).toEqual(["a", "d"]);
    expect(columns.map((c) => [c.status, c.tasks.map((t) => t.id)])).toEqual([
      ["sketch", []],
      ["ready", ["b"]],
      ["working", ["e"]],
      ["landing", []],
      ["landed", ["c"]],
    ]);
  });
});

describe("card text", () => {
  test("only working and landing tasks with landing items show progress", () => {
    expect(progress(task("a"))).toBe("2/5");
    expect(progress(task("a", { status: "landing" }))).toBe("2/5");
    expect(progress(task("a", { status: "ready" }))).toBe("");
    expect(progress(task("a", { landing: { done: 0, total: 0 } }))).toBe("");
  });

  test("the repo name is the last folder", () => {
    expect(repoName("/Users/me/dev/hellstack/")).toBe("hellstack");
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
    expect(boardCommand("/r", "")).toEqual(["bun", [cli, "board", "--json"]]);
    expect(boardCommand("/r", "/tmp/f")).toEqual([
      "env",
      ["FACTORY_HOME=/tmp/f", "bun", cli, "board", "--json"],
    ]);
  });

  test("missing fields in the output get the empty values", () => {
    expect(parseBoard('{"inbox":2}')).toEqual({
      tasks: [],
      inbox: 2,
      invalid: 0,
      sources: [],
      feed: [],
    });
  });

  test("output that the board cannot show is an error, not a render crash", () => {
    const { landing: _, ...noLanding } = task("a");
    expect(parseBoard(JSON.stringify({ tasks: [task("a")] })).tasks).toHaveLength(1);
    expect(() => parseBoard(JSON.stringify({ tasks: [noLanding] }))).toThrow("unknown shape");
    expect(() => parseBoard('{"tasks":null}')).toThrow("unknown shape");
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
