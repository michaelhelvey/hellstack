import { readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { initLedger } from "../../src/core/ledger.ts";
import { promptPath, taskPath } from "../../src/core/paths.ts";
import { roleSections } from "../../src/extension/prompt.ts";
import { tempLedger } from "../core/helpers.ts";

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
    expect(first.factory_coordinator).toContain("hard 10 second limit");
    expect(first.factory_coordinator).not.toContain("name: factory");
    expect(first.factory_memory).toContain("# Coordinator memory");

    await writeFile(paths.coordinator, "# Memory\n\n- the user likes small PRs\n");
    const second = await roleSections({ kind: "coordinator" }, paths);
    expect(second.factory_memory).toContain("the user likes small PRs");
  });

  test("a worker gets WORKER.md and its task file", async () => {
    const paths = await tempLedger();
    const sections = await roleSections({ kind: "worker", task: "t-7f3a" }, paths);
    expect(Object.keys(sections)).toEqual(["factory_rules", "factory_worker"]);
    expect(sections.factory_worker).toContain("# Factory worker");
    expect(sections.factory_worker).toContain(`Your task file is ${taskPath(paths, "t-7f3a")}.`);
  });

  test("a design session gets its task file and the template", async () => {
    const paths = await tempLedger();
    const sections = await roleSections({ kind: "design", task: "t-7f3a" }, paths);
    expect(Object.keys(sections)).toEqual(["factory_rules", "factory_design"]);
    expect(sections.factory_design).toContain(taskPath(paths, "t-7f3a"));
    expect(sections.factory_design).toContain("factory_handoff");
    expect(sections.factory_design).toContain("## Verification");
  });
});
