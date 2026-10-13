import { beforeAll, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { Subagent, SubagentStatus } from "../../../src/herdr-agents/provider.ts";
import { formatElapsed, MAX_ROWS, renderAgentRows } from "../../../src/herdr-agents/ui/rows.ts";
import { testTheme } from "../theme.ts";

const NOW = 1_000_000;

let theme: Theme;

beforeAll(async () => {
  theme = await testTheme();
});

function agent(title: string, status: SubagentStatus = "working"): Subagent {
  return {
    id: title.toLowerCase(),
    title,
    model: "claude-bridge/claude-opus-5-5",
    task: "Review the code for errors and report each error with its file and line",
    status,
    startedAt: NOW - 72_000,
    statusChangedAt: NOW,
  };
}

function render(agents: readonly Subagent[], width: number): string[] {
  return renderAgentRows(agents, { theme, width, now: NOW }).map((line) => Bun.stripANSI(line));
}

test("renderAgentRows draws nothing when there are no subagents", () => {
  expect(renderAgentRows([], { theme, width: 100, now: NOW })).toEqual([]);
});

test.each([140, 100, 70, 44])("each line fills the width of %p columns exactly", (width) => {
  const agents = [agent("Reviewer"), agent("Planner", "blocked"), agent("Docs", "done")];
  const lines = renderAgentRows(agents, { theme, width, now: NOW });
  expect(lines.map((line) => visibleWidth(line))).toEqual(lines.map(() => width));
});

test("the header counts the subagents in each state", () => {
  const agents = [agent("A"), agent("B"), agent("C", "blocked"), agent("D", "done")];
  const [header] = render(agents, 120);
  expect(header).toContain("4 agents");
  expect(header).toContain("2 working · ▲ 1 blocked · ✓ 1 done");
});

function firstRow(width: number): string {
  return render([agent("Reviewer")], width)[1] ?? "";
}

test("a wide row shows the title, the model, the task, the badge, and the elapsed time", () => {
  const row = firstRow(140);
  expect(row).toMatch(
    /Reviewer\s+claude-bridge\/claude-opus-5-5\s+Review the code.*WORKING\s+1m12s/,
  );
});

test("a narrow row removes the model first, then the elapsed time", () => {
  const medium = firstRow(70);
  expect(medium).not.toContain("claude-bridge");
  expect(medium).toContain("1m12s");
  const narrow = firstRow(44);
  expect(narrow).toContain("WORKING");
  expect(narrow).not.toContain("1m12s");
});

test("a long task ends with an ellipsis", () => {
  expect(firstRow(100)).toContain("…");
});

test("the footer counts the subagents that do not fit", () => {
  const agents = Array.from({ length: MAX_ROWS + 3 }, (_, i) => agent(`Agent ${i}`));
  const lines = render(agents, 100);
  expect(lines).toHaveLength(MAX_ROWS + 2);
  expect(lines.at(-1)).toContain("+3 more");
});

test.each([
  [0, "0s"],
  [42_900, "42s"],
  [187_000, "3m07s"],
  [3_900_000, "1h05m"],
])("formatElapsed(%p) is %p", (ms, expected) => {
  expect(formatElapsed(ms)).toBe(expected);
});
