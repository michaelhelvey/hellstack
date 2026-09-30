import { expect, test } from "bun:test";

import type { TodoStore } from "../../src/todo/store.ts";
import { expectTodo, makeStore } from "./test-helpers.ts";
import { runTodoAction } from "../../src/todo/tool.ts";

async function listedIds(store: TodoStore, action: "list" | "list-all"): Promise<string[]> {
  const { details } = await runTodoAction(store, { action });
  return "todos" in details ? details.todos.map((todo) => todo.id) : [];
}

test("list leaves out closed todos, and list-all includes them", async () => {
  const store = await makeStore();
  const open = expectTodo(await store.create({ title: "Open" }));
  const closed = expectTodo(await store.create({ title: "Closed", status: "closed" }));
  expect(await listedIds(store, "list")).toEqual([open.id]);
  expect(await listedIds(store, "list-all")).toEqual([open.id, closed.id]);
});

test("actions that need an id report the missing id", async () => {
  const store = await makeStore();
  const result = await runTodoAction(store, { action: "claim" });
  expect(result.content).toEqual([{ type: "text", text: "Error: id required" }]);
  expect(result.details).toEqual({ action: "claim", error: "id required" });
});

test("the agent sees todo ids in display form", async () => {
  const store = await makeStore();
  const result = await runTodoAction(store, { action: "create", title: "Shown" });
  const [content] = result.content;
  const todo = "todo" in result.details ? result.details.todo : undefined;
  expect(content?.type === "text" ? content.text : "").toContain(`"id": "TODO-${todo?.id}"`);
});
