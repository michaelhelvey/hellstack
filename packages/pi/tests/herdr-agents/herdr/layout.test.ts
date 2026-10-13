import { expect, test } from "bun:test";

import { chooseSplit, slug, tabLabel } from "../../../src/herdr-agents/herdr/layout.ts";

test.each([
  ["hellstack", "hellstack"],
  ["Code Review!", "code-review"],
  ["--", "fallback"],
  ["a very long group name that does not fit", "a-very-long-group-name-t"],
])("slug(%p) is %p", (text, expected) => {
  expect(slug(text, "fallback")).toBe(expected);
});

test("tabLabel uses the lowest number that no tab uses", () => {
  const taken = new Set(["hellstack-review-1", "hellstack-review-3", "other-review-2"]);
  expect(tabLabel("hellstack", "review", taken)).toBe("hellstack-review-2");
  expect(tabLabel("My Project", "", new Set())).toBe("my-project-work-1");
});

function pane(id: string, width: number, height: number) {
  return { pane_id: id, rect: { width, height } };
}

test("chooseSplit splits the largest subagent pane, to the right when it is wide", () => {
  const panes = [pane("user", 400, 100), pane("a", 200, 50), pane("b", 100, 50)];
  expect(chooseSplit(panes, new Set(["a", "b"]))).toEqual({ paneId: "a", direction: "right" });
});

test("chooseSplit splits a tall pane down", () => {
  expect(chooseSplit([pane("a", 90, 50)], new Set(["a"]))).toEqual({
    paneId: "a",
    direction: "down",
  });
});

test("chooseSplit returns undefined when no pane is a subagent pane", () => {
  expect(chooseSplit([pane("user", 400, 100)], new Set(["a"]))).toBeUndefined();
});
