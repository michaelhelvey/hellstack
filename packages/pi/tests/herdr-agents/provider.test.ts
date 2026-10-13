import { expect, test } from "bun:test";

import { subagentId } from "../../src/herdr-agents/provider.ts";

test.each([
  ["Reviewer", [], "reviewer"],
  ["Code Reviewer!", [], "code-reviewer"],
  ["Reviewer", ["reviewer", "reviewer-2"], "reviewer-3"],
  ["42 Docs", [], "docs"],
  ["!!!", [], "agent"],
  ["An extremely long title for a subagent", [], "an-extremely-long-title-for"],
])("subagentId(%p) with the ids %p is %p", (title, taken, expected) => {
  expect(subagentId(title, new Set(taken))).toBe(expected);
});
