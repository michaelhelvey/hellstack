import { expect, test } from "bun:test";

import { parseTodoContent, serializeTodo, splitFrontMatter } from "../../src/todo/file-format.ts";
import type { TodoRecord } from "../../src/todo/model.ts";

const TODO: TodoRecord = {
  id: "deadbeef",
  title: 'Fix "}" parsing {',
  tags: ["qa"],
  status: "open",
  created_at: "2026-01-25T17:00:00.000Z",
  assigned_to_session: "session-a",
  body: "Notes with { braces } in the body.",
};

test("serializeTodo output parses back to the same todo, with a final newline in the body", () => {
  expect(parseTodoContent(serializeTodo(TODO), TODO.id)).toEqual({
    ...TODO,
    body: `${TODO.body}\n`,
  });
});

test("splitFrontMatter ignores braces and escaped quotes inside JSON strings", () => {
  const content = '{"title": "a \\" } b"}\n\n{ not front matter }';
  expect(splitFrontMatter(content)).toEqual({
    frontMatter: '{"title": "a \\" } b"}',
    body: "{ not front matter }",
  });
});

test("splitFrontMatter uses all content as the body when the JSON object is not complete", () => {
  expect(splitFrontMatter('{"title": "x"\nbody')).toEqual({
    frontMatter: "",
    body: '{"title": "x"\nbody',
  });
});

test("parseTodoContent uses defaults for fields that are missing or not valid", () => {
  const content = '{"title": 3, "tags": ["a", 1], "status": "", "assigned_to_session": "  "}';
  expect(parseTodoContent(content, "cafebabe")).toEqual({
    id: "cafebabe",
    title: "",
    tags: ["a"],
    status: "open",
    created_at: "",
    assigned_to_session: undefined,
    body: "",
  });
});

test("serializeTodo leaves out an empty assignment and an empty body", () => {
  const text = serializeTodo({ ...TODO, assigned_to_session: undefined, body: "\n  \n" });
  expect(text).not.toContain("assigned_to_session");
  expect(text.endsWith("}\n")).toBe(true);
});
