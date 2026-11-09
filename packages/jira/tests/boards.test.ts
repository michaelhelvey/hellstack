import { expect, test } from "bun:test";
import { boardIssues, listBoards } from "../src/jira/boards.ts";
import { opsEpics } from "../src/jira/ops.ts";
import { fakeAtlassian } from "./fake.ts";

const issue = (key: string, status: string, extra: Record<string, unknown> = {}) => ({
  key,
  fields: { summary: key, status: { name: status, statusCategory: { key: "new" } }, ...extra },
});

const board = (id: number) => ({
  id,
  name: `B${id}`,
  type: "scrum",
  location: { projectKey: "PT" },
});

const epic = (key: string, project: string, created: string) =>
  issue(key, "In Progress", { project: { key: project }, created });

test("listBoards follows the pages until isLast", async () => {
  const jira = fakeAtlassian((call) =>
    call.query["startAt"] === 0
      ? { startAt: 0, isLast: false, values: [board(1), board(2)] }
      : { startAt: 2, isLast: true, values: [{ id: 3, name: "B3", type: "kanban" }] },
  );
  const boards = await jira.run(listBoards({ project: "PT" }));
  expect(boards.map((b) => [b.id, b.project])).toEqual([
    [1, "PT"],
    [2, "PT"],
    [3, null],
  ]);
  expect(jira.calls.map((c) => [c.query["startAt"], c.query["projectKeyOrId"]])).toEqual([
    [0, "PT"],
    [2, "PT"],
  ]);
});

test("boardIssues uses the open sprints, only my issues, and hides Accounted issues", async () => {
  const jira = fakeAtlassian(() => ({
    startAt: 0,
    total: 2,
    issues: [issue("PT-1", "To Do"), issue("PT-2", "Accounted")],
  }));
  const issues = await jira.run(boardIssues({ board: 905, scope: "sprint", mine: true }));
  expect(issues.map((i) => i.key)).toEqual(["PT-1"]);
  expect(jira.calls[0]?.path).toBe("/rest/agile/1.0/board/905/issue");
  expect(jira.calls[0]?.query["jql"]).toBe("sprint in openSprints() AND assignee = currentUser()");
});

test("boardIssues reads the backlog without JQL", async () => {
  const jira = fakeAtlassian(() => ({ startAt: 0, isLast: true, issues: [] }));
  await jira.run(boardIssues({ board: 7, scope: "backlog" }));
  expect(jira.calls[0]?.path).toBe("/rest/agile/1.0/board/7/backlog");
  expect(jira.calls[0]?.query["jql"]).toBeUndefined();
});

test("opsEpics puts the epic with my recent ops time first, then the most active project", async () => {
  const jira = fakeAtlassian((call) => {
    if (call.path.startsWith("/rest/agile")) {
      return {
        startAt: 0,
        isLast: true,
        values: [{ id: 1, name: "Core Board", type: "scrum", location: { projectKey: "CS" } }],
      };
    }
    const jql = String(call.query["jql"]);
    if (jql.includes("Business Category")) {
      return {
        issues: [
          epic("PT-1", "PT", "2026-01-01"),
          epic("CS-1", "CS", "2026-02-01"),
          epic("XX-1", "XX", "2025-01-01"),
        ],
      };
    }
    if (jql.includes("parent in"))
      return { issues: [issue("CS-9", "Done", { parent: { key: "CS-1" } })] };
    return {
      issues: ["PT", "PT", "XX"].map((p, i) =>
        issue(`${p}-${i + 10}`, "Done", { project: { key: p } }),
      ),
    };
  });
  const result = await jira.run(opsEpics());
  expect(result.matchedBy).toBe("business-category");
  expect(
    result.epics.map((e) => [e.key, e.myOpsIssues30d, e.myProjectIssues60d, e.boards]),
  ).toEqual([
    ["CS-1", 1, 0, ["Core Board"]],
    ["PT-1", 0, 2, []],
    ["XX-1", 0, 1, []],
  ]);
});

test("opsEpics falls back to epic summaries when no epic has the Business Category", async () => {
  const jira = fakeAtlassian(() => ({ issues: [] }));
  const result = await jira.run(opsEpics());
  expect(result).toEqual({ matchedBy: "summary", epics: [] });
  expect(String(jira.calls[1]?.query["jql"])).toContain('summary ~ "Operations"');
});
