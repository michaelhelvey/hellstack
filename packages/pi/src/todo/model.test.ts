import { expect, test } from "bun:test";

import { parseTodoId } from "./ids.ts";
import { filterTodos, sortTodos, type TodoFrontMatter } from "./model.ts";

function todo(id: string, fields: Partial<TodoFrontMatter> = {}): TodoFrontMatter {
  return { id, title: id, tags: [], status: "open", created_at: "", ...fields };
}

test.each([
  ["TODO-DEADBEEF", "deadbeef"],
  ["#deadbeef", "deadbeef"],
  [" todo-0123abcd ", "0123abcd"],
  ["TODO-xyz", undefined],
  ["deadbeef00", undefined],
])("parseTodoId(%p) is %p", (input, expected) => {
  expect(parseTodoId(input)).toBe(expected);
});

test("sortTodos puts assigned todos first and closed todos last, then older todos first", () => {
  const todos = [
    todo("closed", { status: "done", created_at: "1" }),
    todo("open-new", { created_at: "3" }),
    todo("open-old", { created_at: "2" }),
    todo("assigned", { created_at: "4", assigned_to_session: "s" }),
  ];
  expect(sortTodos(todos).map((t) => t.id)).toEqual(["assigned", "open-old", "open-new", "closed"]);
});

test("filterTodos keeps only todos that match all words of the query", () => {
  const todos = [
    todo("a", { title: "Fix login bug", tags: ["auth"] }),
    todo("b", { title: "Fix layout" }),
  ];
  expect(filterTodos(todos, "fix auth").map((t) => t.id)).toEqual(["a"]);
  expect(filterTodos(todos, "  ").map((t) => t.id)).toEqual(["a", "b"]);
});

test("filterTodos puts closed matches after open matches", () => {
  const todos = [todo("a", { title: "Deploy", status: "closed" }), todo("b", { title: "Deploy" })];
  expect(filterTodos(todos, "deploy").map((t) => t.id)).toEqual(["b", "a"]);
});
