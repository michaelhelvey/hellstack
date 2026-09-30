import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  type ChatRequest,
  type FakeReply,
  type FakeReplyStep,
  lastToolResult,
} from "./harness/fake-model.ts";
import { PiSandbox } from "./harness/sandbox.ts";
import { TodoDir } from "./harness/todo-files.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;
let todos: TodoDir;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
  todos = new TodoDir(path.join(sandbox.workDir, ".pi/todos"));
});

afterEach(async () => {
  await sandbox.dispose();
});

const DOWN = "\x1b[B";

function todoCall(args: Record<string, unknown>): FakeReply {
  return { toolCalls: [{ name: "todo", arguments: args }] };
}

function lastTodoId(request: ChatRequest): string {
  return z.object({ id: z.string() }).parse(JSON.parse(lastToolResult(request))).id;
}

function withLastTodoId(args: Record<string, unknown>): FakeReplyStep {
  return (request) => todoCall({ ...args, id: lastTodoId(request) });
}

test("the agent creates, claims, appends to, and closes a todo, and pi saves each change", async () => {
  const pi = await sandbox.startRpc();
  sandbox.model.reply(
    todoCall({ action: "create", title: "Ship", body: "One" }),
    withLastTodoId({ action: "claim" }),
    withLastTodoId({ action: "append", body: "Two" }),
    withLastTodoId({ action: "update", status: "done" }),
    { text: "Done." },
  );
  const results = (await pi.prompt("do the work")).toolResults();

  expect(results.map((r) => r.isError)).toEqual([false, false, false, false]);
  const claimed = z.object({ todo: z.object({ id: z.string(), assigned_to_session: z.string() }) });
  const { todo } = claimed.parse(results[1]?.details);
  expect(todo.assigned_to_session).toBe(await pi.sessionId());
  const file = await todos.read(todo.id);
  expect(file).toMatchObject({ title: "Ship", status: "done", body: "One\n\nTwo\n" });
  expect(file).not.toHaveProperty("assigned_to_session");
});

test("list shows open and assigned todos, and list-all also shows closed todos", async () => {
  await todos.write("0000000a", { title: "Open" });
  await todos.write("0000000b", { title: "Mine", assigned_to_session: "other-session" });
  await todos.write("0000000c", { title: "Done", status: "closed" });
  const pi = await sandbox.startRpc();
  sandbox.model.callTools(
    { name: "todo", arguments: { action: "list" } },
    { name: "todo", arguments: { action: "list-all" } },
  );
  const [list, listAll] = (await pi.prompt("list")).toolResults().map((r) => r.text);

  expect(list).toContain("TODO-0000000a");
  expect(list).toContain("TODO-0000000b");
  expect(list).not.toContain("TODO-0000000c");
  expect(listAll).toContain("TODO-0000000c");
});

test("a todo of a different session can be claimed only with force", async () => {
  await todos.write("0000000a", { title: "Taken", assigned_to_session: "other-session" });
  const pi = await sandbox.startRpc();
  sandbox.model.reply(
    { toolCalls: [{ name: "todo", arguments: { action: "claim", id: "TODO-0000000a" } }] },
    { toolCalls: [{ name: "todo", arguments: { action: "claim", id: "0000000a", force: true } }] },
    { text: "Done." },
  );
  const [refused, forced] = (await pi.prompt("claim it")).toolResults().map((r) => r.text);

  expect(refused).toBe(
    "Todo TODO-0000000a is already assigned to session other-session. Use force to override.",
  );
  expect(forced).toContain('"id": "TODO-0000000a"');
  expect((await todos.read("0000000a")).assigned_to_session).toBe(await pi.sessionId());
});

test("the todo tool reports a missing id and a todo that does not exist", async () => {
  const pi = await sandbox.startRpc();
  sandbox.model.callTools(
    { name: "todo", arguments: { action: "get" } },
    { name: "todo", arguments: { action: "get", id: "TODO-deadbeef" } },
  );
  const texts = (await pi.prompt("get")).toolResults().map((r) => r.text);

  expect(texts).toEqual(["Error: id required", "Todo TODO-deadbeef not found"]);
});

test("at session start, pi deletes the closed todos that are older than gcDays", async () => {
  await Bun.write(path.join(todos.dir, "settings.json"), JSON.stringify({ gcDays: 3 }));
  await todos.write("0000000a", { title: "Old closed", status: "closed", ageDays: 10 });
  await todos.write("0000000b", { title: "New closed", status: "closed", ageDays: 1 });
  await todos.write("0000000c", { title: "Old open", ageDays: 10 });
  await sandbox.startRpc();

  expect(await todos.exists("0000000a")).toBe(false);
  expect(await todos.exists("0000000b")).toBe(true);
  expect(await todos.exists("0000000c")).toBe(true);
});

test("PI_TODO_PATH changes the todo folder, and pi makes the folder at session start", async () => {
  await sandbox.dispose();
  sandbox = await PiSandbox.create({ env: { PI_TODO_PATH: "notes/todos" } });
  const pi = await sandbox.startRpc();
  const dir = path.join(sandbox.workDir, "notes/todos");
  expect(existsSync(dir)).toBe(true);

  sandbox.model.callTools({ name: "todo", arguments: { action: "create", title: "Here" } });
  const [created] = (await pi.prompt("create")).toolResults();
  const { id } = z.object({ id: z.string() }).parse(JSON.parse(created?.text ?? ""));
  expect(await new TodoDir(dir).read(id.replace("TODO-", ""))).toMatchObject({ title: "Here" });
});

test("a stale lock asks the user, and the claim continues when the user says yes", async () => {
  await todos.write("0000000a", { title: "Locked" });
  const lockPath = await todos.writeLock("0000000a", 24 * 60 * 60 * 1000);
  const pi = await sandbox.startRpc();
  pi.onDialog(() => ({ confirmed: true }));
  sandbox.model.callTools({ name: "todo", arguments: { action: "claim", id: "0000000a" } });
  await pi.prompt("claim");

  expect(pi.uiRequests.map((r) => r.method)).toContain("confirm");
  expect((await todos.read("0000000a")).assigned_to_session).toBe(await pi.sessionId());
  expect(existsSync(lockPath)).toBe(false);
});

test("a stale lock stays when the user says no", async () => {
  await todos.write("0000000a", { title: "Locked" });
  const lockPath = await todos.writeLock("0000000a", 24 * 60 * 60 * 1000);
  const pi = await sandbox.startRpc();
  pi.onDialog(() => ({ confirmed: false }));
  sandbox.model.callTools({ name: "todo", arguments: { action: "claim", id: "0000000a" } });
  const [result] = (await pi.prompt("claim")).toolResults();

  expect(result?.text).toBe("Todo TODO-0000000a remains locked.");
  expect(existsSync(lockPath)).toBe(true);
});

test("/todos in print mode prints the todo list", async () => {
  await todos.write("0000000a", { title: "Printed" });
  const { stdout, stderr, exitCode } = await sandbox.print("/todos");

  expect(exitCode).toBe(0);
  expect(stdout + stderr).toContain("Open todos (1):\n  TODO-0000000a Printed");
});

test("/todos in RPC mode shows the todo list as a notification", async () => {
  await todos.write("0000000a", { title: "Notified" });
  const pi = await sandbox.startRpc();
  const notified = pi.nextUiRequest("notify");
  await pi.request({ type: "prompt", message: "/todos" });

  expect((await notified).message).toContain("Open todos (1):\n  TODO-0000000a Notified");
});

async function openTodoMenu(title: string) {
  const pi = sandbox.startTui();
  await pi.waitFor("fake-1");
  await pi.submit("/todos");
  await pi.waitFor(title);
  pi.type("\r");
  await pi.waitFor(`Actions for TODO-0000000a "${title}"`);
  return pi;
}

test("in the /todos manager, the close action closes the todo", async () => {
  await todos.write("0000000a", { title: "Close me" });
  const pi = await openTodoMenu("Close me");
  pi.type(`${DOWN.repeat(3)}\r`);
  await pi.waitFor("Closed todo TODO-0000000a");

  expect((await todos.read("0000000a")).status).toBe("closed");
});

test("in the /todos manager, the work action puts a prompt in the editor", async () => {
  await todos.write("0000000a", { title: "Work on me" });
  const pi = await openTodoMenu("Work on me");
  pi.type(`${DOWN}\r`);

  await pi.waitFor('work on todo TODO-0000000a "Work on me"');
});
