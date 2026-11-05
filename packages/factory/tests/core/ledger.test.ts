import { describe, expect, test } from "bun:test";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";

import { defaultConfig } from "../../src/core/config.ts";
import {
  checkLanding,
  createTask,
  getTask,
  handoff,
  initLedger,
  listTasks,
  logTask,
  updateTask,
  writeTask,
} from "../../src/core/ledger.ts";
import { taskPath, type LedgerPaths } from "../../src/core/paths.ts";
import { landingProgress, sectionText } from "../../src/core/task.ts";
import { completeBody, tempFolder, tempLedger } from "./helpers.ts";

async function sketch(paths: LedgerPaths) {
  return createTask({ title: "Add the router", cwd: await tempFolder() }, paths);
}

describe("initLedger", () => {
  test("makes the ledger and does not replace files", async () => {
    const paths = await tempLedger();
    expect(await initLedger(paths)).toEqual([paths.config, paths.coordinator]);
    expect(JSON.parse(await readFile(paths.config, "utf8"))).toEqual(defaultConfig());
    expect(await readFile(paths.coordinator, "utf8")).toContain("# Coordinator memory");
    expect((await readdir(paths.home)).sort()).toEqual([
      "COORDINATOR.md",
      "config.json",
      "inbox",
      "state",
      "tasks",
    ]);
    await writeFile(paths.coordinator, "my notes");
    expect(await initLedger(paths)).toEqual([]);
    expect(await readFile(paths.coordinator, "utf8")).toBe("my notes");
  });
});

describe("tasks", () => {
  test("createTask writes a sketch from the template", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    expect(task.meta).toMatchObject({ title: "Add the router", status: "sketch", paused: false });
    expect(await getTask(task.meta.id, paths)).toEqual(task);
    expect(sectionText(task.body, "Goal")).toBe("");
    expect(await readdir(paths.tasks)).toEqual([`${task.meta.id}.md`]);
  });

  test("updateTask changes fields and sets updated", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    await Bun.sleep(5);
    const updated = await updateTask(task.meta.id, { now: "testing", threads: ["task:x"] }, paths);
    expect(updated.meta).toMatchObject({
      now: "testing",
      threads: ["task:x"],
      created: task.meta.created,
    });
    expect(updated.meta.updated > task.meta.updated).toBe(true);
    expect(updated.body).toBe(task.body);
  });

  test("updateTask does not move a sketch to ready", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const toReady = await updateTask(task.meta.id, { status: "ready" }, paths).catch(String);
    expect(toReady).toContain("use handoff");
    expect(await readdir(paths.tasks)).toEqual([`${task.meta.id}.md`]);
    expect(await updateTask("t-0000", { now: "x" }, paths).catch(String)).toContain(
      "no task t-0000",
    );
  });

  test("updateTask does not change undefined fields", async () => {
    const paths = await tempLedger();
    const { meta } = await sketch(paths);
    await updateTask(meta.id, { needs_you: "which repo?", now: "asking" }, paths);
    const updated = await updateTask(meta.id, { status: "dropped", needs_you: undefined }, paths);
    expect(updated.meta).toMatchObject({
      status: "dropped",
      needs_you: "which repo?",
      now: "asking",
    });
  });

  test("updateTask allows only the status changes of the lifecycle", async () => {
    const paths = await tempLedger();
    const { meta } = await sketch(paths);
    const toWorking = await updateTask(meta.id, { status: "working" }, paths).catch(String);
    expect(toWorking).toContain("cannot go from sketch to working");
    await updateTask(meta.id, { status: "dropped" }, paths);
    const fromDropped = await updateTask(meta.id, { status: "sketch" }, paths).catch(String);
    expect(fromDropped).toContain("cannot go from dropped to sketch");
  });

  test("updateTask changes cwd only in sketch and ready", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const { meta } = await writeTask({ ...task, body: completeBody }, paths);
    expect((await updateTask(meta.id, { cwd: "/a" }, paths)).meta.cwd).toBe("/a");
    const relative = await updateTask(meta.id, { cwd: "a" }, paths).catch(String);
    expect(relative).toContain("absolute");
    await updateTask(meta.id, { cwd: meta.cwd }, paths);
    expect((await handoff(meta.id, paths)).ok).toBe(true);
    expect((await updateTask(meta.id, { cwd: "/b" }, paths)).meta.cwd).toBe("/b");
    await updateTask(meta.id, { status: "working", cwd: "/b" }, paths);
    const working = await updateTask(meta.id, { cwd: "/c" }, paths).catch(String);
    expect(working).toContain("cwd can change only in sketch or ready");
  });

  test("createTask can set threads and a Goal draft", async () => {
    const paths = await tempLedger();
    const fields = { title: "x", cwd: paths.home, threads: ["gh:a/b#1"], goal: "Fix [b#1](u)." };
    const task = await createTask(fields, paths);
    expect(task.meta.threads).toEqual(["gh:a/b#1"]);
    expect(sectionText(task.body, "Goal")).toBe("Fix [b#1](u).");
  });

  test("the change to landed sets landed_at one time", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const { meta } = await writeTask({ ...task, body: completeBody }, paths);
    expect(meta.landed_at).toBeNull();
    expect((await handoff(meta.id, paths)).ok).toBe(true);
    for (const status of ["working", "landing"] as const)
      await updateTask(meta.id, { status }, paths);
    const landed = await updateTask(meta.id, { status: "landed" }, paths);
    expect(landed.meta.landed_at).toBe(landed.meta.updated);
    await Bun.sleep(5);
    const again = await updateTask(meta.id, { status: "landed", now: "deployed" }, paths);
    expect(again.meta.landed_at).toBe(landed.meta.landed_at);
    expect(again.meta.updated).not.toBe(landed.meta.updated);
  });

  test("a working task can land without landing", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const { meta } = await writeTask({ ...task, body: completeBody }, paths);
    expect((await handoff(meta.id, paths)).ok).toBe(true);
    await updateTask(meta.id, { status: "working" }, paths);
    const landed = await updateTask(meta.id, { status: "landed" }, paths);
    expect(landed.meta).toMatchObject({ status: "landed", landed_at: landed.meta.updated });
  });

  test("parallel writes do not lose an update", async () => {
    const paths = await tempLedger();
    const { meta } = await sketch(paths);
    const texts = ["a", "b", "c", "d", "e"];
    await Promise.all(texts.map((text) => logTask(meta.id, { who: "w", text }, paths)));
    const log = sectionText((await getTask(meta.id, paths)).body, "Log") ?? "";
    expect(
      log
        .split("\n")
        .map((line) => line.slice(-1))
        .sort(),
    ).toEqual(texts);
  });

  test("task ids cannot leave the tasks folder", async () => {
    const paths = await tempLedger();
    expect(await getTask("../config", paths).catch(String)).toContain("not a valid task id");
  });

  test("a file whose name is not its id is not valid", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    await copyFile(taskPath(paths, task.meta.id), taskPath(paths, "t-0000"));
    const list = await listTasks(paths);
    expect(list.tasks.map((t) => t.meta.id)).toEqual([task.meta.id]);
    expect(list.invalid[0]?.error).toContain("does not match the id");
    expect(await getTask("t-0000", paths).catch(String)).toContain("does not match the id");
  });

  test("logTask and checkLanding edit the body", async () => {
    const paths = await tempLedger();
    const task = await writeTask({ ...(await sketch(paths)), body: completeBody }, paths);
    await logTask(task.meta.id, { who: "worker", text: "merged" }, paths);
    const checked = await checkLanding(task.meta.id, 2, paths);
    expect(landingProgress(checked.body)).toEqual({ done: 2, total: 2 });
    expect(sectionText(checked.body, "Log")).toMatch(/opened PR #88\n- \S+ worker: merged$/);
  });

  test("listTasks reports files that are not valid", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    await writeFile(taskPath(paths, "t-bad0"), "no front matter");
    const list = await listTasks(paths);
    expect(list.tasks).toEqual([task]);
    expect(list.invalid).toEqual([
      { path: taskPath(paths, "t-bad0"), error: "the task file has no front matter" },
    ]);
  });
});

describe("handoff", () => {
  test("returns the missing parts and does not change the task", async () => {
    const paths = await tempLedger();
    const task = await sketch(paths);
    const result = await handoff(task.meta.id, paths);
    expect(result.ok || result.missing).toContain("Goal has no text");
    expect(await getTask(task.meta.id, paths)).toEqual(task);
  });

  test("moves a complete sketch to ready one time", async () => {
    const paths = await tempLedger();
    const task = await writeTask({ ...(await sketch(paths)), body: completeBody }, paths);
    const result = await handoff(task.meta.id, paths);
    expect(result.ok && result.task.meta.status).toBe("ready");
    expect(await handoff(task.meta.id, paths)).toEqual({
      ok: false,
      missing: ["status is ready, not sketch"],
    });
  });
});
