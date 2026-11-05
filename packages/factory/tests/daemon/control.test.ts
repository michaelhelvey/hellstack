import { describe, expect, test } from "bun:test";

import { writeTask, type HcTerminal } from "../../src/core/index.ts";
import { daemonRun, down, status, up, type ControlDeps } from "../../src/daemon/control.ts";
import { tempLedger } from "../core/helpers.ts";
import { fakeHc, task, terminal } from "./helpers.ts";

async function deps(terminals: HcTerminal[] = [], live = false) {
  const paths = await tempLedger();
  const fake = fakeHc(terminals, live ? { state: "live" } : undefined);
  const started: string[] = [];
  const control: ControlDeps = {
    hc: fake.hc,
    paths,
    root: "/root",
    startCoordinator: (config) => Promise.resolve(started.push(config.coordinator.model)),
  };
  return { control, fake, started, paths };
}

describe("control", () => {
  test("up starts the coordinator and factoryd when they do not run", async () => {
    const { control, fake, started } = await deps();
    expect(await up(control)).toEqual(["started the coordinator", "started factoryd"]);
    expect(started).toEqual(["claude-sonnet-5-5"]);
    expect(fake.calls).toContain("run factoryd");
  });

  test("up does nothing when both run", async () => {
    const running = [terminal({ name: "factory" }), terminal({ name: "factoryd", agent: "bun" })];
    const { control, fake, started } = await deps(running);
    expect(await up(control)).toEqual(["the coordinator runs", "factoryd runs"]);
    expect(started).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  test("the daemon runs in the repository root with the ledger of the caller", async () => {
    const { paths } = await deps();
    expect(daemonRun(paths, "/root")).toEqual({
      name: "factoryd",
      cwd: "/root",
      env: { FACTORY_HOME: paths.home },
      argv: ["bun", "packages/factory/src/cli.ts", "daemon"],
    });
  });

  test("down ends and removes factoryd and the coordinator only", async () => {
    const { control, fake } = await deps([], true);
    await down(control);
    expect(fake.calls).toEqual([
      "get factoryd",
      "kill factoryd",
      "rm factoryd",
      "get factory",
      "kill factory",
      "rm factory",
    ]);
  });

  test("status tells what runs and counts the tasks", async () => {
    const { control, paths } = await deps([
      terminal({ name: "factory", address: "t9", status: "working", turn: 3 }),
      terminal(),
    ]);
    await writeTask(task({ status: "working" }), paths);
    await writeTask(task({ id: "t-0002", status: "ready" }), paths);
    expect(await status(control)).toEqual([
      `ledger: ${paths.home}`,
      "factoryd: stopped",
      "coordinator: running (t9, working, turn 3)",
      "workers: 1 running",
      "tasks: 1 ready, 1 working",
      "inbox: 0",
    ]);
  });
});
