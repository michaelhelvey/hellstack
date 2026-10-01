import { expect, test } from "bun:test";
import { parse } from "jsonc-parser";

import { appendJsonValues, setJsonValue } from "../src/json.ts";

const jsonc = `{
  // a comment
  "plugins": ["a"],
}
`;

test("appendJsonValues adds values to the end of an array and keeps the comments", () => {
  const text = appendJsonValues(jsonc, ["plugins"], ["b", "c"]);
  expect(text).toContain("// a comment");
  expect(parse(text)).toEqual({ plugins: ["a", "b", "c"] });
});

test("appendJsonValues adds values to an empty array", () => {
  expect(JSON.parse(appendJsonValues('{ "plugins": [] }', ["plugins"], ["a"]))).toEqual({
    plugins: ["a"],
  });
});

test("appendJsonValues makes the array when it does not exist", () => {
  expect(JSON.parse(appendJsonValues("{}", ["plugins"], ["a"]))).toEqual({ plugins: ["a"] });
});

test("appendJsonValues rejects a value that is not an array", () => {
  expect(() => appendJsonValues('{ "plugins": "a" }', ["plugins"], ["b"])).toThrow();
});

test("setJsonValue replaces a value and keeps the other values", () => {
  const text = setJsonValue('{ "models": ["a"], "theme": "x" }', ["models"], ["b"]);
  expect(JSON.parse(text)).toEqual({ models: ["b"], theme: "x" });
});
