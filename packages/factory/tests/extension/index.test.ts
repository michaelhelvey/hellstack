import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test } from "bun:test";

import { getTask, listTasks } from "../../src/core/ledger.ts";
import { ledgerPaths } from "../../src/core/paths.ts";
import type { FactoryCommand } from "../../src/extension/commands.ts";
import { factoryExtension } from "../../src/extension/index.ts";
import { FACTORY_SKILL_DIR } from "../../src/extension/prompt.ts";
import { ROLE_ENTRY } from "../../src/extension/role.ts";
import { tempFolder } from "../core/helpers.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

function emptyState() {
  return {
    handlers: new Map<string, Handler>(),
    commands: new Map<string, FactoryCommand>(),
    entries: [] as unknown[],
    messages: [] as string[],
    modes: [] as (string | undefined)[],
    notes: [] as string[],
    active: ["read", "bash"],
  };
}

function recorder() {
  const state = emptyState();
  const api = {
    on: (event: string, handler: Handler) => state.handlers.set(event, handler),
    registerTool: (tool: { name: string; executionMode?: string; defaultActive?: boolean }) => {
      state.modes.push(tool.executionMode);
      if (tool.defaultActive !== false) state.active = [...state.active, tool.name];
    },
    registerCommand: (name: string, cmd: FactoryCommand) => state.commands.set(name, cmd),
    getActiveTools: () => state.active,
    setActiveTools: (names: string[]) => (state.active = names),
    appendEntry: (customType: string, data: unknown) =>
      state.entries.push({ type: "custom", customType, data }),
    sendMessage: (message: { content: string }) => state.messages.push(message.content),
  };
  return { state, api: api as unknown as ExtensionAPI };
}

function fakePi(env: NodeJS.ProcessEnv) {
  const { state, api } = recorder();
  factoryExtension(api, { ...env, FACTORY_HOME: home });
  const ui = { notify: (text: string) => state.notes.push(text) };
  return {
    ...state,
    active: () => state.active,
    emit: (event: string, payload: unknown = {}) => state.handlers.get(event)?.(payload, {}),
    start: (branch: unknown[] = [], event = "session_start") =>
      state.handlers.get(event)?.({}, { sessionManager: { getBranch: () => branch } }),
    run: async (name: string, args: string, cwd: string) =>
      state.commands.get(name)?.handler(args, { cwd, ui } as never),
  };
}

function bashTimeout(pi: ReturnType<typeof fakePi>, timeout?: number): number | undefined {
  const input: { command: string; timeout?: number } = { command: "sleep 30" };
  if (timeout !== undefined) input.timeout = timeout;
  pi.emit("tool_call", { toolName: "bash", input });
  return input.timeout;
}

let home = "";
beforeEach(async () => {
  home = await tempFolder();
});

describe("the coordinator", () => {
  test("bash runs at most 10 seconds", () => {
    const pi = fakePi({ FACTORY_ROLE: "coordinator" });
    expect(bashTimeout(pi)).toBe(10);
    expect(bashTimeout(pi, 600)).toBe(10);
    expect(bashTimeout(pi, 2)).toBe(2);
  });

  test("gets its tools and the factory skill", () => {
    const pi = fakePi({ FACTORY_ROLE: "coordinator" });
    pi.start();
    const tools = ["factory_task", "factory_inbox", "factory_dispatch", "factory_handoff"];
    expect(pi.active()).toEqual(["read", "bash", ...tools]);
    expect(pi.modes).toEqual(tools.map(() => "sequential"));
    expect(pi.emit("resources_discover")).toEqual({ skillPaths: [FACTORY_SKILL_DIR] });
  });

  test("cannot use /sketch or /handoff", async () => {
    const pi = fakePi({ FACTORY_ROLE: "coordinator" });
    pi.start();
    await pi.run("sketch", "Another task", "/");
    expect(pi.notes.at(-1)).toContain("this session is the factory coordinator");
    await pi.run("handoff", "", "/");
    expect(pi.notes.at(-1)).toBe("only a factory design session can do this");
  });
});

test("a worker gets factory_task, /park, and no bash limit", () => {
  const pi = fakePi({ FACTORY_ROLE: "worker", FACTORY_TASK: "t-7f3a" });
  pi.start();
  expect(pi.active()).toEqual(["read", "bash", "factory_task"]);
  expect([...pi.commands.keys()]).toEqual(["sketch", "handoff", "park", "unpark"]);
  expect(bashTimeout(pi)).toBeUndefined();
  expect(pi.emit("resources_discover")).toEqual({});
});

describe("/sketch", () => {
  test("makes a sketch in the session folder and makes the session its designer", async () => {
    const pi = fakePi({});
    pi.start();
    expect(pi.active()).toEqual(["read", "bash"]);
    const repo = await tempFolder();
    await pi.run("sketch", "  Fix the login bug ", repo);

    const { tasks } = await listTasks(ledgerPaths(home));
    const task = tasks[0];
    expect(task?.meta).toMatchObject({ title: "Fix the login bug", cwd: repo, status: "sketch" });
    const role = { kind: "design", task: task?.meta.id };
    expect(pi.entries).toEqual([{ type: "custom", customType: ROLE_ENTRY, data: role }]);
    expect(pi.active()).toEqual(["read", "bash", "factory_task", "factory_handoff"]);
    expect(pi.messages[0]).toContain(`${home}/tasks/${task?.meta.id}.md`);

    await pi.run("handoff", "", repo);
    expect(pi.notes.at(-1)).toContain("Goal has no text");
  });

  test("needs a title", async () => {
    const pi = fakePi({});
    pi.start();
    await pi.run("sketch", " ", "/");
    expect(pi.notes).toEqual(["usage: /sketch <title>"]);
  });

  test("a resumed session keeps the design role; a new session loses it", async () => {
    const pi = fakePi({});
    const repo = await tempFolder();
    pi.start();
    await pi.run("sketch", "Fix it", repo);
    pi.start(pi.entries);
    expect(pi.active()).toContain("factory_handoff");
    pi.start([]);
    expect(pi.active()).toEqual(["read", "bash"]);
  });

  test("a move in the session tree to before /sketch drops the design role", async () => {
    const pi = fakePi({});
    pi.start();
    await pi.run("sketch", "Fix it", await tempFolder());
    pi.start([], "session_tree");
    expect(pi.active()).toEqual(["read", "bash"]);
  });
});

test("a design agent gets its role from the env and cannot use /sketch", async () => {
  const pi = fakePi({ FACTORY_ROLE: "design", FACTORY_TASK: "t-7f3a" });
  pi.start();
  expect(pi.active()).toEqual(["read", "bash", "factory_task", "factory_handoff"]);
  await pi.run("sketch", "Another task", "/");
  expect(pi.notes.at(-1)).toContain("this session is the factory design");
  expect((await listTasks(ledgerPaths(home))).tasks).toEqual([]);
});

test("/park pauses the worker task", async () => {
  const pi = fakePi({});
  const repo = await tempFolder();
  pi.start();
  await pi.run("sketch", "Fix it", repo);
  const id = (await listTasks(ledgerPaths(home))).tasks[0]?.meta.id ?? "";

  const worker = fakePi({ FACTORY_ROLE: "worker", FACTORY_TASK: id });
  worker.start();
  await worker.run("park", "", repo);
  expect((await getTask(id, ledgerPaths(home))).meta.paused).toBe(true);
  await worker.run("unpark", "", repo);
  expect((await getTask(id, ledgerPaths(home))).meta.paused).toBe(false);
});
