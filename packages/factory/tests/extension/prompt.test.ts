import { readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { createTask, initLedger, updateTask } from "../../src/core/ledger.ts";
import { promptPath, taskPath } from "../../src/core/paths.ts";
import { designDonePrompt, designPrompt, roleSections } from "../../src/extension/prompt.ts";
import { tempFolder, tempLedger } from "../core/helpers.ts";

const rules = (await readFile(promptPath("chinchilla.md"), "utf8")).trim();

describe("roleSections", () => {
  test("a session without a role gets nothing; a subagent gets only the rules", async () => {
    const paths = await tempLedger();
    expect(await roleSections({ kind: "none" }, paths)).toEqual({});
    expect(await roleSections({ kind: "subagent" }, paths)).toEqual({ factory_rules: rules });
  });

  test("the coordinator gets the skill and the live COORDINATOR.md", async () => {
    const paths = await tempLedger();
    await initLedger(paths);
    const first = await roleSections({ kind: "coordinator" }, paths);
    expect(Object.keys(first)).toEqual(["factory_rules", "factory_coordinator", "factory_memory"]);
    expect(first.factory_coordinator).not.toContain("name: factory");
    expect(first.factory_memory).toContain((await readFile(paths.coordinator, "utf8")).trim());

    await writeFile(paths.coordinator, "# Memory\n\n- the user likes small PRs\n");
    const second = await roleSections({ kind: "coordinator" }, paths);
    expect(second.factory_memory).toContain("the user likes small PRs");
  });

  test("a worker gets WORKER.md and its task file", async () => {
    const paths = await tempLedger();
    const sections = await roleSections({ kind: "worker", task: "t-7f3a" }, paths);
    expect(Object.keys(sections)).toEqual(["factory_rules", "factory_worker"]);
    expect(sections.factory_worker).toContain(`Your task file is ${taskPath(paths, "t-7f3a")}.`);
  });

  test("a design session gets its task file and the template while the task is a sketch", async () => {
    const paths = await tempLedger();
    const task = await createTask({ title: "Fix it", repo: await tempFolder() }, paths);
    const role = { kind: "design", task: task.meta.id } as const;
    const sketch = await roleSections(role, paths);
    expect(Object.keys(sketch)).toEqual(["factory_rules", "factory_design"]);
    expect(sketch.factory_design).toBe(
      `${designPrompt(role, paths)}\n\nThe task template:\n\n${(await readFile(promptPath("task-template.md"), "utf8")).trim()}`,
    );

    await updateTask(task.meta.id, { status: "dropped" }, paths);
    const done = await roleSections(role, paths);
    expect(done.factory_design).toBe(designDonePrompt(role, paths, "dropped"));
  });
});
