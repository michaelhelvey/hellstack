import { describe, expect, test } from "bun:test";

import { reconcile } from "../../src/daemon/reconcile.ts";
import { task, terminal } from "./helpers.ts";

const now = new Date("2026-11-05T18:00:00.000Z");
const fresh = { updated: "2026-11-05T17:59:00.000Z" };

function plan(tasks = [task()], terminals = [terminal()], notices: string[] = []) {
  return reconcile({ tasks, terminals, notices, now, staleAfterMinutes: 120 });
}

describe("reconcile", () => {
  test("starts each working or landing worker that does not run pi", () => {
    const tasks = [
      task({ id: "t-0001", status: "working", ...fresh }),
      task({ id: "t-0002", status: "landing", ...fresh }),
      task({ id: "t-0003", status: "working", paused: true, ...fresh }),
      task({ id: "t-0004", status: "landed", ...fresh }),
      task({ id: "t-0005", status: "working", ...fresh }),
    ];
    const terminals = [
      terminal({ name: "factory-t-0001", agent: "zsh" }),
      terminal({ name: "factory-t-0005" }),
    ];
    expect(plan(tasks, terminals).start.map((t) => t.meta.id)).toEqual(["t-0001", "t-0002"]);
  });

  test("tells about a ready task one time", () => {
    const ready = task({ status: "ready", ...fresh });
    const first = plan([ready], []);
    expect(first.notify).toEqual(['- task t-7f3a is ready: "Add the router"']);
    expect(plan([ready], [], first.notices).notify).toEqual([]);
  });

  test("tells one time about a stale task whose worker is not working", () => {
    const stale = task({ status: "working", updated: "2026-11-05T15:00:00.000Z" });
    const idle = terminal({ status: "idle" });
    const first = plan([stale], [idle]);
    expect(first.notify).toEqual([
      "- task t-7f3a has had no update for 180 minutes and its worker is not working",
    ]);
    expect(plan([stale], [idle], first.notices).notify).toEqual([]);
    expect(plan([stale], [terminal({ status: "working" })]).notify).toEqual([]);
    const updated = task({ status: "working", updated: "2026-11-05T15:30:00.000Z" });
    expect(plan([updated], [idle], first.notices).notify).toHaveLength(1);
  });

  test("forgets the notices of tasks that do not exist", () => {
    expect(plan([], [], ["ready:t-dead", "stale:t-dead:x"]).notices).toEqual([]);
  });
});
