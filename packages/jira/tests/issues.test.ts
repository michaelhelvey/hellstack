import { describe, expect, test } from "bun:test";
import {
  createIssue,
  readIssue,
  resolveFields,
  transitionIssue,
  updateIssue,
} from "../src/jira/issues.ts";
import { searchIssues } from "../src/jira/search.ts";
import { type Call, fakeAtlassian, ME, routes, SITE } from "./fake.ts";

const FIELDS = [
  { id: "summary", name: "Summary", custom: false },
  { id: "customfield_1", name: "Story Points", custom: true },
  { id: "customfield_2", name: "Business Category", custom: true },
  { id: "customfield_3", name: "Epic Link CWIP", custom: true },
  { id: "customfield_4", name: "Acceptance Criteria", custom: true },
];

const posts = (calls: ReadonlyArray<Call>) => calls.filter((call) => call.method !== "GET");

const fieldsJira = () => fakeAtlassian(routes({ "GET /rest/api/3/field": FIELDS }));

describe("resolveFields", () => {
  test("changes field names to field IDs and keeps field IDs", async () => {
    const fields = await fieldsJira().run(resolveFields({ "story points": 3, customfield_1: 5 }));
    expect(fields).toEqual({ customfield_1: 5 });
    expect(await fieldsJira().run(resolveFields({ "Story Points": 3 }))).toEqual({
      customfield_1: 3,
    });
  });

  test("refuses the fields that project managers set, by name or by ID", async () => {
    expect(await fieldsJira().failure(resolveFields({ "Business Category": "Ops" }))).toContain(
      '"Business Category" is set by project managers',
    );
    expect(await fieldsJira().failure(resolveFields({ customfield_3: "x" }))).toContain(
      '"Epic Link CWIP" is set by project managers',
    );
  });

  test("fails for a field that does not exist", async () => {
    expect(await fieldsJira().failure(resolveFields({ Nope: 1 }))).toBe(
      'no field has the ID or name "Nope"',
    );
  });
});

describe("createIssue", () => {
  const responses = {
    "GET /rest/api/3/myself": ME,
    "GET /rest/api/3/project/PT": {
      issueTypes: [
        { id: "10", name: "Story", subtask: false, hierarchyLevel: 0 },
        { id: "11", name: "Subtask", subtask: true, hierarchyLevel: -1 },
      ],
    },
    "POST /rest/api/3/issue": (call: Call) =>
      JSON.stringify(call.body).includes('"id":"11"') ? { key: "PT-2" } : { key: "PT-1" },
  };

  test("uses the parent field, a 10h estimate, and an ADF description", async () => {
    const jira = fakeAtlassian(routes(responses));
    const created = await jira.run(
      createIssue({
        project: "PT",
        type: "Task",
        summary: "Do it",
        parent: "OPS-9",
        description: "First.\n\nSecond.",
      }),
    );
    expect(created).toEqual({ key: "PT-1", url: `${SITE}/browse/PT-1`, subtask: null });
    expect(posts(jira.calls)[0]?.body).toEqual({
      fields: {
        project: { key: "PT" },
        issuetype: { name: "Task" },
        summary: "Do it",
        parent: { key: "OPS-9" },
        timetracking: { originalEstimate: "10h" },
        description: {
          type: "doc",
          version: 1,
          content: [
            { type: "paragraph", content: [{ type: "text", text: "First." }] },
            { type: "paragraph", content: [{ type: "text", text: "Second." }] },
          ],
        },
      },
    });
  });

  test("withSubtask adds a Sub-task with the same summary, estimate, and assignee", async () => {
    const jira = fakeAtlassian(routes(responses));
    const created = await jira.run(
      createIssue({
        project: "PT",
        type: "Story",
        summary: "Feature",
        estimate: "4h",
        assignee: "me",
        description: "Only on the story",
        withSubtask: true,
      }),
    );
    expect(created.subtask).toEqual({ key: "PT-2", url: `${SITE}/browse/PT-2` });
    expect(posts(jira.calls)[1]?.body).toEqual({
      fields: {
        project: { key: "PT" },
        issuetype: { id: "11" },
        summary: "Feature",
        parent: { key: "PT-1" },
        timetracking: { originalEstimate: "4h" },
        assignee: { accountId: "me" },
      },
    });
  });
});

test("updateIssue fails when there is nothing to change", async () => {
  const jira = fakeAtlassian(routes({}));
  expect(await jira.failure(updateIssue("PT-1", {}))).toBe("give at least one field to change");
});

test("updateIssue can remove the assignee", async () => {
  const jira = fakeAtlassian(routes({ "PUT /rest/api/3/issue/PT-1": null }));
  await jira.run(updateIssue("PT-1", { assignee: null }));
  expect(jira.calls[0]?.body).toEqual({ fields: { assignee: { accountId: null } } });
});

describe("transitionIssue", () => {
  const transitions = {
    transitions: [
      {
        id: "1",
        name: "Start",
        to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      },
      { id: "2", name: "Finish", to: { name: "Done", statusCategory: { key: "done" } } },
    ],
  };
  const jira = () =>
    fakeAtlassian(
      routes({
        "GET /rest/api/3/issue/PT-1/transitions": transitions,
        "POST /rest/api/3/issue/PT-1/transitions": null,
      }),
    );

  test("matches the status name or the transition name, in any case", async () => {
    const fake = jira();
    expect(await fake.run(transitionIssue("PT-1", "finish"))).toMatchObject({ status: "Done" });
    expect(await fake.run(transitionIssue("PT-1", "in progress"))).toMatchObject({
      status: "In Progress",
    });
    expect(posts(fake.calls).map((call) => call.body)).toEqual([
      { transition: { id: "2" } },
      { transition: { id: "1" } },
    ]);
  });

  test("lists the available statuses when the move is not possible", async () => {
    expect(await jira().failure(transitionIssue("PT-1", "Blocked"))).toBe(
      'PT-1 cannot move to "Blocked". Available: In Progress (Start), Done (Finish)',
    );
  });

  test("refuses Accounted without a request", async () => {
    const fake = jira();
    expect(await fake.failure(transitionIssue("PT-1", "accounted"))).toContain(
      "only project managers",
    );
    expect(fake.calls).toEqual([]);
  });
});

test("readIssue finds the Acceptance Criteria by the field name and gives text", async () => {
  const jira = fakeAtlassian(
    routes({
      "GET /rest/api/3/issue/PT-1": {
        key: "PT-1",
        names: { customfield_4: "Acceptance Criteria" },
        fields: {
          summary: "Story",
          description: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Why." }] }],
          },
          customfield_4: {
            type: "doc",
            content: [
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "It works" }] }],
                  },
                ],
              },
            ],
          },
          subtasks: [{ key: "PT-2", fields: { summary: "Story" } }],
          comment: {
            comments: [
              { created: "1", body: "old" },
              { created: "2", author: { displayName: "Ann" }, body: "new" },
            ],
          },
        },
      },
    }),
  );
  const issue = await jira.run(readIssue("PT-1", 1));
  expect(issue).toMatchObject({
    description: "Why.",
    acceptanceCriteria: "- It works",
    subtasks: [{ key: "PT-2", summary: "Story", status: null }],
    comments: [{ author: "Ann", created: "2", body: "new" }],
    timetracking: { originalEstimate: null, remainingEstimate: null, timeSpent: null },
  });
});

const doneIssue = (key: string, status: string) => ({
  key,
  fields: {
    summary: key,
    status: { name: status, statusCategory: { key: "done" } },
    customfield_1: 3,
  },
});

describe("searchIssues", () => {
  test("follows nextPageToken and leaves out Accounted and Removed issues", async () => {
    const jira = fakeAtlassian((call) =>
      call.query["nextPageToken"] === undefined
        ? {
            issues: [doneIssue("A-1", "Done"), doneIssue("A-2", "Accounted")],
            nextPageToken: "p2",
          }
        : { issues: [doneIssue("A-3", "removed"), doneIssue("A-4", "To Do")] },
    );
    const result = await jira.run(searchIssues({ jql: "project = A", limit: 10 }));
    expect(result.issues.map((i) => i.key)).toEqual(["A-1", "A-4"]);
    expect(result.hiddenCount).toBe(2);
    expect(jira.calls.map((c) => c.query["maxResults"])).toEqual([10, 8]);
  });

  test("gives the raw values of the fields that the caller asks for", async () => {
    const jira = fakeAtlassian(() => ({ issues: [doneIssue("A-1", "Done")] }));
    const result = await jira.run(
      searchIssues({ jql: "x", fields: ["customfield_1", "customfield_9"], includeHidden: true }),
    );
    expect(result.issues[0]?.fields).toEqual({ customfield_1: 3, customfield_9: null });
    expect(String(jira.calls[0]?.query["fields"])).toEndWith(",customfield_1,customfield_9");
  });
});
