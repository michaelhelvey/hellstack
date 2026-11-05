import { describe, expect, test } from "bun:test";

import { defaultConfig } from "../../src/core/config.ts";
import type { Hc, HcRunOptions, HcTerminalDetail } from "../../src/core/hc.ts";
import { NO_WINDOW, type Herdr, type HerdrName } from "../../src/core/herdr.ts";
import { ledgerPaths, taskPath } from "../../src/core/paths.ts";
import {
  coordinatorRun,
  startCoordinator,
  startWorker,
  WORKER_RESTART_PROMPT,
  workerRun,
} from "../../src/core/spawn.ts";
import { newTask, type Task } from "../../src/core/task.ts";

const paths = ledgerPaths("/home/me/.factory");
const config = defaultConfig();

function task(): Task {
  const now = "2026-11-05T14:00:00.000Z";
  return newTask({ id: "t-7f3a", title: "Add the router", repo: "/repo", template: "", now });
}

function fakeHc(old?: Partial<HcTerminalDetail>) {
  const calls: string[] = [];
  const runs: HcRunOptions[] = [];
  function reply(call: string) {
    calls.push(call);
    return Promise.resolve({});
  }
  const hc: Hc = {
    ls: () => Promise.resolve([]),
    get: (t) => reply(`get ${t}`).then(() => old as HcTerminalDetail | undefined),
    run: (options) => {
      runs.push(options);
      return Promise.resolve({
        address: "t1",
        name: options.name,
        cwd: options.cwd,
        state: "live",
        turn: 0,
      });
    },
    send: (t) => reply(`send ${t}`),
    interrupt: (t) => reply(`interrupt ${t}`),
    kill: (t) => reply(`kill ${t}`),
    rm: (t) => reply(`rm ${t}`),
  };
  return { hc, calls, runs };
}

function fakeHerdr(window: boolean) {
  const names: HerdrName[] = [];
  const herdr: Herdr = {
    spaces: () => Promise.resolve(window ? [] : NO_WINDOW),
    rename: (target) => {
      names.push(target);
      return Promise.resolve(true);
    },
  };
  return { herdr, names };
}

describe("run options", () => {
  test("the worker runs pi in the repo with its own session and the first prompt", () => {
    const run = workerRun(task(), config, { restart: false, pi: ["pi"], paths });
    expect(run).toEqual({
      name: "factory-t-7f3a",
      cwd: "/repo",
      env: { FACTORY_ROLE: "worker", FACTORY_TASK: "t-7f3a", FACTORY_HOME: paths.home },
      argv: [
        ...["pi", "--session-id", "t-7f3a", "--model", "claude-opus-5-5", "--thinking", "high"],
        `You are the factory worker of task t-7f3a. Your task file is ${taskPath(paths, "t-7f3a")}. Read it and do the task.`,
      ],
    });
  });

  test("a restarted worker gets the restart prompt", () => {
    const run = workerRun(task(), config, { restart: true, pi: ["pi"], paths });
    expect(run.argv.at(-1)).toBe(WORKER_RESTART_PROMPT);
  });

  test("the coordinator runs in the ledger with the session factory", () => {
    const run = coordinatorRun(config, { restart: false, pi: ["my-pi"], paths });
    expect(run).toMatchObject({ name: "factory", cwd: paths.home });
    expect(run.env).toEqual({ FACTORY_ROLE: "coordinator", FACTORY_HOME: paths.home });
    expect(run.argv.slice(0, 7)).toEqual([
      ...["my-pi", "--session-id", "factory", "--model", "claude-sonnet-5-5"],
      ...["--thinking", "medium"],
    ]);
  });
});

describe("startWorker", () => {
  test("ends and removes the old terminal, then starts it in Herdr", async () => {
    const { hc, calls, runs } = fakeHc({ state: "live" });
    const { herdr, names } = fakeHerdr(true);
    const started = await startWorker(task(), config, {
      restart: true,
      deps: { hc, herdr, paths },
    });
    expect(started.herdr).toBe("placed");
    expect(calls).toEqual(["get factory-t-7f3a", "kill factory-t-7f3a", "rm factory-t-7f3a"]);
    expect(runs[0]?.labels?.["herdr.tab"]).toBe("tbfactory-t-7f3a");
    expect(names).toEqual([{ kind: "tab", id: "tbfactory-t-7f3a", name: "t-7f3a Add the router" }]);
  });

  test("starts without labels when the Herdr window does not run", async () => {
    const { hc, calls, runs } = fakeHc();
    const { herdr } = fakeHerdr(false);
    const started = await startWorker(task(), config, {
      restart: false,
      deps: { hc, herdr, paths },
    });
    expect(started.herdr).toBe(NO_WINDOW);
    expect(calls).toEqual(["get factory-t-7f3a"]);
    expect(runs[0]?.labels).toBeUndefined();
  });
});

test("startCoordinator names a new factory space", async () => {
  const { hc, runs } = fakeHc({ state: "finished" });
  const { herdr, names } = fakeHerdr(true);
  await startCoordinator(config, { restart: false, deps: { hc, herdr, paths } });
  expect(runs[0]?.labels).toEqual({ "herdr.space": "spfactory", "herdr.tab": "tbfactory" });
  expect(names.map((name) => name.name)).toEqual(["coordinator", "factory"]);
});
