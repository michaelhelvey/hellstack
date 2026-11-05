import { describe, expect, test } from "bun:test";

import type { Hc, HcRunOptions } from "../../src/core/hc.ts";
import { NO_WINDOW } from "../../src/core/herdr.ts";
import { listInbox, writeInbox } from "../../src/core/inbox.ts";
import { createTask, getTask, writeTask } from "../../src/core/ledger.ts";
import type { LedgerPaths } from "../../src/core/paths.ts";
import { landingProgress, sectionText } from "../../src/core/task.ts";
import {
  runDispatch,
  runHandoff,
  runInboxAction,
  runTaskAction,
  type ActionContext,
} from "../../src/extension/actions.ts";
import type { TaskParams } from "../../src/extension/schemas.ts";
import { completeBody, tempFolder, tempLedger } from "../core/helpers.ts";

async function sketch(paths: LedgerPaths, body?: string) {
  const task = await createTask({ title: "Add the router", repo: await tempFolder() }, paths);
  return body === undefined ? task : writeTask({ ...task, body }, paths);
}

function failure(ctx: ActionContext, params: TaskParams): Promise<unknown> {
  return runTaskAction(ctx, params).catch(String);
}

async function coordinatorTask() {
  const ctx: ActionContext = { role: { kind: "coordinator" }, paths: await tempLedger() };
  const repo = await tempFolder();
  const created = await runTaskAction(ctx, { action: "create", title: "Fix login", repo });
  const id = /sketch (t-[0-9a-f]+)/.exec(created)?.[1] ?? "";
  await writeTask({ ...(await getTask(id, ctx.paths)), body: completeBody }, ctx.paths);
  return { ctx, id, repo };
}

describe("factory_task", () => {
  test("the coordinator creates, updates, logs, and checks tasks", async () => {
    const { ctx, id, repo } = await coordinatorTask();
    await runTaskAction(ctx, { action: "update", id, needs_you: "approve?", threads: ["t:1"] });
    await runTaskAction(ctx, { action: "log", id, text: "proposed" });
    await runTaskAction(ctx, { action: "check", id, item: 2 });
    const task = await getTask(id, ctx.paths);
    expect(task.meta).toMatchObject({ needs_you: "approve?", threads: ["t:1"], repo });
    expect(sectionText(task.body, "Log")).toMatch(/coordinator: proposed$/);
    expect(landingProgress(task.body)).toEqual({ done: 2, total: 2 });
  });

  test("list shows one line per task; an empty needs_you clears it", async () => {
    const { ctx, id } = await coordinatorTask();
    await runTaskAction(ctx, { action: "update", id, needs_you: "approve?" });
    expect(await runTaskAction(ctx, { action: "list" })).toBe(
      `${id} [sketch] Fix login | landing 1/2 | needs you: approve?`,
    );
    await runTaskAction(ctx, { action: "update", id, needs_you: "" });
    expect((await getTask(id, ctx.paths)).meta.needs_you).toBeNull();
  });

  test("a call fails without its required fields", async () => {
    const ctx: ActionContext = { role: { kind: "coordinator" }, paths: await tempLedger() };
    expect(await failure(ctx, { action: "get" })).toContain("id is required");
    expect(await failure(ctx, { action: "create", title: "x" })).toContain("repo is required");
    expect(await failure(ctx, { action: "update", id: "t-0000" })).toContain("at least one");
  });

  test("a worker acts only on its own task", async () => {
    const paths = await tempLedger();
    const own = await sketch(paths);
    const other = await sketch(paths);
    const ctx: ActionContext = { role: { kind: "worker", task: own.meta.id }, paths };

    await runTaskAction(ctx, { action: "update", now: "coding" });
    expect((await getTask(own.meta.id, paths)).meta.now).toBe("coding");
    expect(await failure(ctx, { action: "update", id: other.meta.id, now: "x" })).toContain(
      `only on its own task ${own.meta.id}`,
    );
    expect(await failure(ctx, { action: "list" })).toContain("cannot list");
    expect(await failure(ctx, { action: "create", title: "x", repo: "/" })).toContain(
      "cannot create",
    );
    expect((await getTask(other.meta.id, paths)).meta.now).toBe("");
  });

  test("a design session acts on its own task when the call gives no id", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const ctx: ActionContext = { role: { kind: "design", task: task.meta.id }, paths };
    await runTaskAction(ctx, { action: "update", title: "Add the event router" });
    expect((await getTask(task.meta.id, paths)).meta.title).toBe("Add the event router");
  });
});

describe("factory_handoff", () => {
  test("names the missing parts and does not change the task", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const ctx: ActionContext = { role: { kind: "design", task: task.meta.id }, paths };
    const error = await runHandoff(ctx, undefined).catch(String);
    expect(error).toContain("handoff failed");
    expect(error).toContain("Goal has no text");
    expect(error).toContain("Landing has no checkbox items");
    expect((await getTask(task.meta.id, paths)).meta.status).toBe("sketch");
  });

  test("makes a complete sketch ready, one time", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths, completeBody);
    const ctx: ActionContext = { role: { kind: "coordinator" }, paths };
    expect(await runHandoff(ctx, task.meta.id)).toContain("[ready]");
    expect(await runHandoff(ctx, task.meta.id).catch(String)).toContain("status is ready");
  });
});

describe("factory_inbox", () => {
  test("lists and dismisses events", async () => {
    const paths = await tempLedger();
    expect(await runInboxAction(paths, { action: "list" })).toBe("The inbox is empty.");
    const event = {
      ...({ id: "e-1", source: "github", thread: "gh:a/b#1", kind: "pr_comment" } as const),
      ...{ title: "Rename x", summary: "", url: "https://x", ts: "2026-11-05T14:00:00.000Z" },
    };
    await writeInbox(event, paths);
    expect(await runInboxAction(paths, { action: "list" })).toBe(
      'e-1 2026-11-05T14:00:00.000Z gh:a/b#1 pr_comment "Rename x" https://x',
    );
    await runInboxAction(paths, { action: "dismiss", id: "e-1" });
    expect(await listInbox(paths)).toEqual([]);
  });
});

describe("factory_dispatch", () => {
  function fakeHc() {
    const runs: HcRunOptions[] = [];
    function reply(): Promise<Record<string, unknown>> {
      return Promise.resolve({});
    }
    const hc: Hc = {
      ls: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      run: (options) => {
        runs.push(options);
        return Promise.resolve({
          address: "t1",
          name: options.name,
          cwd: "/",
          state: "live",
          turn: 0,
        });
      },
      ...{ send: reply, interrupt: reply, kill: reply, rm: reply },
    };
    return { hc, runs };
  }
  const herdr = { spaces: () => Promise.resolve(NO_WINDOW), rename: () => Promise.resolve(true) };

  test("starts the worker of a ready task and sets it to working", async () => {
    const paths = await tempLedger();
    const base = await sketch(paths);
    const task = await writeTask({ ...base, meta: { ...base.meta, status: "ready" } }, paths);
    const { hc, runs } = fakeHc();
    const text = await runDispatch(paths, task.meta.id, { hc, herdr, pi: ["pi"] });
    expect(text).toContain(`factory-${task.meta.id}`);
    expect(runs[0]?.env).toEqual({
      FACTORY_ROLE: "worker",
      FACTORY_TASK: task.meta.id,
      FACTORY_HOME: paths.home,
    });
    const working = await getTask(task.meta.id, paths);
    expect(working.meta.status).toBe("working");
    expect(sectionText(working.body, "Log")).toContain("coordinator: dispatched");
  });

  test("does not start the worker of a task that is not ready", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const { hc, runs } = fakeHc();
    const error = await runDispatch(paths, task.meta.id, { hc, herdr }).catch(String);
    expect(error).toContain("is sketch, not ready");
    expect(runs).toEqual([]);
  });
});
