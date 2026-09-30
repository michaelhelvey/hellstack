import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expectError, expectTodo, makeStore, storeFor } from "./test-helpers.ts";

test("create writes a todo file that get reads back", async () => {
  const store = await makeStore();
  const created = expectTodo(
    await store.create({ title: "Write tests", tags: ["qa"], body: "Hi" }),
  );
  const read = expectTodo(await store.get(`TODO-${created.id.toUpperCase()}`));
  expect(read).toEqual({ ...created, body: "Hi\n" });
  expect(await readFile(store.pathFor(created.id), "utf8")).toStartWith("{");
});

test("claim fails for a todo of a different session unless force is set", async () => {
  const a = await makeStore({ id: "session-a" });
  const b = storeFor(a.dir, { id: "session-b" });
  const { id } = expectTodo(await a.create({ title: "Shared" }));
  expectTodo(await a.claim(id));
  expect(expectError(await b.claim(id))).toContain("already assigned to session session-a");
  expect(expectTodo(await b.claim(id, true)).assigned_to_session).toBe("session-b");
});

test("release fails for a todo of a different session unless force is set", async () => {
  const a = await makeStore({ id: "session-a" });
  const b = storeFor(a.dir, { id: "session-b" });
  const { id } = expectTodo(await a.create({ title: "Shared" }));
  expectTodo(await a.claim(id));
  expect(expectError(await b.release(id))).toContain("Use force to release");
  expect(expectTodo(await b.release(id, true)).assigned_to_session).toBeUndefined();
});

test("closing a todo removes its assignment, and a closed todo cannot be claimed", async () => {
  const store = await makeStore();
  const { id } = expectTodo(await store.create({ title: "Finish" }));
  expectTodo(await store.claim(id));
  const closed = expectTodo(await store.update(id, { status: "done", title: undefined }));
  expect(closed).toMatchObject({ status: "done", title: "Finish", assigned_to_session: undefined });
  expect(expectError(await store.claim(id))).toContain("is closed");
});

test("append adds text after a blank line and ignores empty text", async () => {
  const store = await makeStore();
  const { id } = expectTodo(await store.create({ title: "Notes", body: "First\n" }));
  expectTodo(await store.append(id, "  \n"));
  expect(expectTodo(await store.append(id, "Second")).body).toBe("First\n\nSecond\n");
  expect(expectTodo(await store.get(id)).body).toBe("First\n\nSecond\n");
});

test("delete removes the todo file", async () => {
  const store = await makeStore();
  const { id } = expectTodo(await store.create({ title: "Remove me" }));
  expectTodo(await store.delete(id));
  expect(existsSync(store.pathFor(id))).toBe(false);
  expect(expectError(await store.get(id))).toBe(`Todo TODO-${id} not found`);
});

test("operations reject ids that are not valid", async () => {
  const store = await makeStore();
  expect(expectError(await store.update("../../etc/passwd", {}))).toContain("Invalid todo id");
});

test("list returns assigned todos first and ignores files that are not todos", async () => {
  const store = await makeStore();
  const open = expectTodo(await store.create({ title: "Open" }));
  const assigned = expectTodo(await store.create({ title: "Assigned" }));
  expectTodo(await store.claim(assigned.id));
  await writeFile(path.join(store.dir, "settings.json"), "{}");
  expect((await store.list()).map((todo) => todo.id)).toEqual([assigned.id, open.id]);
});
