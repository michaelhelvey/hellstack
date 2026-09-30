import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeTodo } from "./file-format.ts";
import { LOCK_TTL_MS } from "./lock.ts";
import { getTodosDir, type TodoStore } from "./store.ts";
import { expectError, expectTodo, makeStore } from "./test-helpers.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

async function writeTodo(store: TodoStore, id: string, status: string, ageDays: number) {
  const created_at = new Date(Date.now() - ageDays * DAY_MS).toISOString();
  const todo = { id, title: id, tags: [], status, created_at, body: "" };
  await writeFile(store.pathFor(id), serializeTodo(todo));
}

async function writeLock(store: TodoStore, id: string, ageMs: number): Promise<string> {
  const lockPath = path.join(store.dir, `${id}.lock`);
  await writeFile(lockPath, JSON.stringify({ session: "other.jsonl" }));
  const time = new Date(Date.now() - ageMs);
  await utimes(lockPath, time, time);
  return lockPath;
}

test("collectGarbage deletes only closed todos that are older than gcDays", async () => {
  const store = await makeStore();
  await writeFile(path.join(store.dir, "settings.json"), JSON.stringify({ gcDays: 3 }));
  await writeTodo(store, "00000001", "closed", 5);
  await writeTodo(store, "00000002", "closed", 1);
  await writeTodo(store, "00000003", "open", 5);
  await store.collectGarbage();
  expect((await store.list()).map((todo) => todo.id).sort()).toEqual(["00000002", "00000003"]);
});

test("collectGarbage deletes nothing when the gc setting is off", async () => {
  const store = await makeStore();
  await writeFile(path.join(store.dir, "settings.json"), JSON.stringify({ gc: false }));
  await writeTodo(store, "00000001", "closed", 30);
  await store.collectGarbage();
  expect(existsSync(store.pathFor("00000001"))).toBe(true);
});

test("a fresh lock blocks changes and names the session that has the lock", async () => {
  const store = await makeStore();
  const { id } = expectTodo(await store.create({ title: "Locked" }));
  await writeLock(store, id, 0);
  expect(expectError(await store.claim(id))).toBe(
    `Todo TODO-${id} is locked (session other.jsonl). Try again later.`,
  );
});

test("a stale lock blocks changes when there is no UI to confirm", async () => {
  const store = await makeStore({ confirm: undefined });
  const { id } = expectTodo(await store.create({ title: "Stale" }));
  await writeLock(store, id, LOCK_TTL_MS + 1000);
  expect(expectError(await store.claim(id))).toContain("lock is stale");
});

test("a stale lock is taken when the user confirms, and is removed after the change", async () => {
  const store = await makeStore({ confirm: () => Promise.resolve(true) });
  const { id } = expectTodo(await store.create({ title: "Stale" }));
  const lockPath = await writeLock(store, id, LOCK_TTL_MS + 1000);
  expect(expectTodo(await store.claim(id)).assigned_to_session).toBe("session-a");
  expect(existsSync(lockPath)).toBe(false);
});

test("getTodosDir uses PI_TODO_PATH relative to the working directory", () => {
  expect(getTodosDir("/work", {})).toBe("/work/.pi/todos");
  expect(getTodosDir("/work", { PI_TODO_PATH: " notes/todos " })).toBe("/work/notes/todos");
  expect(getTodosDir("/work", { PI_TODO_PATH: "  " })).toBe("/work/.pi/todos");
});
