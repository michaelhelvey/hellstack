import { describe, expect, test } from "bun:test";

import { reconcile } from "../../src/daemon/reconcile.ts";
import { task, terminal } from "./helpers.ts";

const now = new Date("2026-11-05T18:00:00.000Z");
const fresh = { updated: "2026-11-05T17:59:00.000Z" };

function plan(tasks = [task()], terminals = [terminal()], notices: string[] = []) {
  return reconcile({
    tasks,
    terminals,
    notices,
    now,
    staleAfterMinutes: 120,
    closeAfterMinutes: 60,
  });
}

function closed(tasks = [task()], terminals = [terminal()]) {
  return plan(tasks, terminals).close.map(({ terminal, minutes }) => [terminal, minutes]);
}

const landed = { status: "landed" as const, landed_at: "2026-11-05T16:00:00.000Z", ...fresh };

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

  test("closes the idle worker of a task that landed long enough ago", () => {
    const idle = terminal({ status: "done", status_ms: Date.parse("2026-11-05T16:30:00.000Z") });
    expect(closed([task(landed)], [idle])).toEqual([["factory-t-7f3a", 120]]);
    expect(closed([task(landed)], [terminal({ status: null, status_ms: null })])).toEqual([
      ["factory-t-7f3a", 120],
    ]);
  });

  test("closes the idle design agent of a finished task too", () => {
    const design = terminal({ name: "factory-design-t-7f3a", status: "idle", status_ms: null });
    expect(closed([task(landed)], [design])).toEqual([["factory-design-t-7f3a", 120]]);
    expect(closed([task({ status: "ready" })], [design])).toEqual([]);
  });

  test("keeps the worker of a landed task when its status changed recently", () => {
    const recent = terminal({ status: "done", status_ms: Date.parse("2026-11-05T17:30:00.000Z") });
    expect(closed([task(landed)], [recent])).toEqual([]);
    expect(closed([task({ ...landed, landed_at: "2026-11-05T17:30:00.000Z" })])).toEqual([]);
  });

  test("never closes a working terminal or the worker of a task that is not done", () => {
    expect(closed([task(landed)], [terminal({ status: "working" })])).toEqual([]);
    const old = { updated: "2026-11-05T10:00:00.000Z" };
    for (const status of ["working", "landing", "ready"] as const)
      expect(closed([task({ status, ...old })])).toEqual([]);
  });

  test("measures a dropped task from its last update", () => {
    function dropped(updated: string) {
      return task({ status: "dropped", updated });
    }
    expect(closed([dropped("2026-11-05T16:30:00.000Z")])).toEqual([["factory-t-7f3a", 90]]);
    expect(closed([dropped("2026-11-05T17:30:00.000Z")])).toEqual([]);
  });

  test("forgets the notices of tasks that do not exist", () => {
    expect(plan([], [], ["ready:t-dead", "stale:t-dead:x"]).notices).toEqual([]);
  });
});
