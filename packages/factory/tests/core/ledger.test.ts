import { describe, expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";

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
  return createTask({ title: "Add the router", repo: await tempFolder() }, paths);
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
    expect(await updateTask("t-0000", { now: "x" }, paths).catch(String)).toContain(
      "no task t-0000",
    );
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
