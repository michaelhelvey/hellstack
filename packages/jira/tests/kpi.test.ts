import { describe, expect, test } from "bun:test";
import {
  createKpi,
  listKpis,
  loadSource,
  planWeeks,
  setWeek,
  type KpiSource,
} from "../src/jira/kpi/actions.ts";
import {
  parseWeeks,
  pickWeek,
  quarterFirstFriday,
  weekGrid,
  weeklyDueDates,
} from "../src/jira/kpi/weeks.ts";
import { fakeAtlassian, ME, routes, SITE } from "./fake.ts";

const SUBTASK = { id: "5", name: "Sub-task", subtask: true, hierarchyLevel: -1 };
const TASK = { id: "4", name: "Task", subtask: false, hierarchyLevel: 0 };

/** Since 2026-10, "Yes" and "No" are both in the Done category. Weeks start as "Open". */
const STATUS = {
  Yes: { name: "Yes", statusCategory: { key: "done" } },
  No: { name: "No", statusCategory: { key: "done" } },
  Open: { name: "Open", statusCategory: { key: "new" } },
};

const week = (key: string, n: number, due: string, status: keyof typeof STATUS = "Open") => ({
  key,
  fields: {
    summary: `     Week ${n} - Ship it`,
    duedate: due,
    issuetype: SUBTASK,
    status: STATUS[status],
  },
});

const WEEKS = [
  week("T-3", 3, "2026-10-16"),
  week("T-1", 1, "2026-10-02", "No"),
  week("T-2", 2, "2026-10-09", "Yes"),
  week("T-4", 4, "2026-10-23"),
];

/** "Did not do" comes first, so a transition by category would pick "No" for a "Yes". */
const TRANSITIONS = {
  transitions: [
    { id: "3", name: "Did not do", to: STATUS.No },
    { id: "2", name: "KPI Completed", to: STATUS.Yes },
    {
      id: "11",
      name: "Start",
      to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    },
  ],
};

const SOURCE: KpiSource = {
  key: "S-50",
  summary: "Last quarter",
  project: "S",
  type: TASK,
  subtaskTypeId: "5",
  weeks: parseWeeks(WEEKS),
};

describe("weeks", () => {
  test("the result comes from the status name, not the status category", () => {
    expect(parseWeeks(WEEKS).map((w) => [w.number, w.status, w.result])).toEqual([
      [1, "No", "No"],
      [2, "Yes", "Yes"],
      [3, "Open", null],
      [4, "Open", null],
    ]);
  });

  test("ignores sub-tasks without a week number", () => {
    expect(parseWeeks([{ key: "X-1", fields: { summary: "Notes" } }])).toEqual([]);
  });

  test("the current week is the first week due on or after today", () => {
    const weeks = parseWeeks(WEEKS);
    expect(pickWeek(weeks, "current", "2026-10-09")?.number).toBe(2);
    expect(pickWeek(weeks, "current", "2026-10-10")?.number).toBe(3);
    expect(pickWeek(weeks, "previous", "2026-10-12")?.number).toBe(2);
    expect(pickWeek(weeks, "current", "2027-01-01")).toBeUndefined();
  });

  test("the grid marks Yes, No, past weeks without a result, and future weeks", () => {
    expect(weekGrid(parseWeeks(WEEKS), "2026-10-20")).toBe("NY!.");
  });

  test("due dates are weekly from the first Friday of the quarter", () => {
    expect(quarterFirstFriday("2026-11-09")).toBe("2026-10-02");
    expect(quarterFirstFriday("2027-02-15")).toBe("2027-01-01");
    expect(weeklyDueDates("2026-12-25", 2)).toEqual(["2026-12-25", "2027-01-01"]);
  });
});

const KPI = {
  key: "STRAT-499",
  fields: {
    summary: "Ship it",
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    parent: { key: "STRAT-7" },
    project: { key: "STRAT" },
    issuetype: TASK,
  },
};

/** Answers the searches of the KPI functions from the JQL. */
const kpiSearch = (jql: string) => {
  if (jql.includes('"Week 1"')) {
    return {
      issues: [{ key: "T-1", fields: { summary: "Week 1", parent: { key: "STRAT-499" } } }],
    };
  }
  if (jql.startsWith("key in")) return { issues: [KPI] };
  return {
    issues: WEEKS.map((w) => ({
      key: w.key,
      fields: { ...w.fields, parent: { key: "STRAT-499" } },
    })),
  };
};

describe("loadSource", () => {
  test("the source is the newest KPI of the user, with its weeks", async () => {
    const jira = fakeAtlassian((call) => kpiSearch(String(call.query["jql"])));
    const found = await jira.run(loadSource);
    expect(found).toMatchObject({ key: "STRAT-499", project: "STRAT", subtaskTypeId: "5" });
    expect(found.weeks).toHaveLength(4);
  });

  test("fails when the user has no KPI", async () => {
    const jira = fakeAtlassian(() => ({ issues: [] }));
    expect(await jira.failure(loadSource)).toContain("you have no KPI to copy");
  });
});

test("listKpis finds the KPIs from the user's weeks, and shows No and missing weeks", async () => {
  const jira = fakeAtlassian((call) => kpiSearch(String(call.query["jql"])));
  const [kpi] = await jira.run(listKpis(false, "2026-10-20"));
  expect(kpi).toMatchObject({
    key: "STRAT-499",
    rock: "STRAT-7",
    grid: "NY!.",
    missing: [3],
    thisWeek: { number: 4, result: null },
  });
  expect(jira.calls[1]?.query["jql"]).toBe(
    "key in (STRAT-499) AND statusCategory != Done ORDER BY created DESC",
  );
});

describe("planWeeks", () => {
  test("weeks are due weekly from the first Friday of the quarter, and summaries name the KPI", () => {
    expect(planWeeks(SOURCE, "Ship", "2027-02-15")).toEqual([
      { number: 1, summary: "Week 1 - Ship", due: "2027-01-01" },
      { number: 2, summary: "Week 2 - Ship", due: "2027-01-08" },
      { number: 3, summary: "Week 3 - Ship", due: "2027-01-15" },
      { number: 4, summary: "Week 4 - Ship", due: "2027-01-22" },
    ]);
  });

  test("weeks are due weekly from firstDue when it is given", () => {
    expect(planWeeks(SOURCE, "Ship", "2026-11-09", "2027-01-08")[1]?.due).toBe("2027-01-15");
  });
});

describe("createKpi", () => {
  const responses = {
    "GET /rest/api/3/myself": ME,
    "POST /rest/api/3/issue": { key: "S-100" },
    "POST /rest/api/3/issue/bulk": {
      issues: [{ key: "S-101" }, { key: "S-102" }, { key: "S-103" }, { key: "S-104" }],
    },
    "GET /rest/api/3/issue/S-100/transitions": TRANSITIONS,
    "POST /rest/api/3/issue/S-100/transitions": null,
  };

  test("makes the KPI and its weeks, and moves the KPI to In Progress", async () => {
    const jira = fakeAtlassian(routes(responses));
    const created = await jira.run(
      createKpi(SOURCE, { summary: "Ship it", rock: "S-7" }, "2026-11-09"),
    );

    expect(created).toMatchObject({
      dryRun: false,
      key: "S-100",
      url: `${SITE}/browse/S-100`,
      status: "In Progress",
    });
    expect(created.weeks.map((w) => w.key)).toEqual(["S-101", "S-102", "S-103", "S-104"]);
    const sent = jira.calls.filter((c) => c.method === "POST");
    expect(sent[0]?.body).toEqual({
      fields: {
        project: { key: "S" },
        issuetype: { id: "4" },
        summary: "Ship it",
        parent: { key: "S-7" },
        assignee: { accountId: "me" },
      },
    });
    expect(sent[1]?.body).toMatchObject({
      issueUpdates: [
        {
          fields: {
            parent: { key: "S-100" },
            summary: "Week 1 - Ship it",
            duedate: "2026-10-02",
            issuetype: { id: "5" },
            assignee: { accountId: "me" },
          },
        },
        { fields: { summary: "Week 2 - Ship it", duedate: "2026-10-09" } },
        { fields: { summary: "Week 3 - Ship it" } },
        { fields: { summary: "Week 4 - Ship it" } },
      ],
    });
    expect(sent[2]?.body).toEqual({ transition: { id: "11" } });
  });

  test("a dry run gives the plan and sends nothing", async () => {
    const jira = fakeAtlassian(routes({}));
    const plan = await jira.run(
      createKpi(SOURCE, { summary: "x", rock: "S-7", dryRun: true }, "2026-11-09"),
    );
    expect(plan).toMatchObject({ dryRun: true, key: null, source: "S-50" });
    expect(jira.calls).toEqual([]);
  });

  test("reports the new KPI key when a weekly sub-task fails", async () => {
    const jira = fakeAtlassian(
      routes({
        ...responses,
        "POST /rest/api/3/issue/bulk": { issues: [], errors: [{ status: 400 }] },
      }),
    );
    expect(
      await jira.failure(createKpi(SOURCE, { summary: "x", rock: "S-7" }, "2026-11-09")),
    ).toContain("created S-100, but some weekly sub-tasks failed");
  });
});

const weekJira = () =>
  fakeAtlassian(
    routes({
      "GET /rest/api/3/search/jql": { issues: WEEKS },
      "GET /rest/api/3/issue/T-3/transitions": TRANSITIONS,
      "POST /rest/api/3/issue/T-3/transitions": null,
      "POST /rest/api/3/issue/T-3/comment": { id: "c1" },
    }),
  );

const transitionBodies = (calls: ReturnType<typeof weekJira>["calls"]) =>
  calls.filter((c) => c.path.endsWith("/transitions") && c.method === "POST").map((c) => c.body);

describe("setWeek", () => {
  test('moves an open week to "Yes" by the status name, and adds the comment', async () => {
    const jira = weekJira();
    const result = await jira.run(
      setWeek({
        kpi: "T-0",
        week: "current",
        result: "Yes",
        comment: "Done.",
        today: "2026-10-12",
      }),
    );
    expect(result).toMatchObject({ changed: true, commented: true });
    expect(result.week).toMatchObject({ key: "T-3", status: "Yes", result: "Yes" });
    expect(transitionBodies(jira.calls)).toEqual([{ transition: { id: "2" } }]);
    expect(jira.calls.at(-1)?.path).toBe("/rest/api/3/issue/T-3/comment");
  });

  test('moves an open week to "No" with "Did not do"', async () => {
    const jira = weekJira();
    await jira.run(setWeek({ kpi: "T-0", week: 3, result: "No", today: "2026-10-12" }));
    expect(transitionBodies(jira.calls)).toEqual([{ transition: { id: "3" } }]);
  });

  test("does not change a week that already has the result", async () => {
    const jira = weekJira();
    const result = await jira.run(
      setWeek({ kpi: "T-0", week: 1, result: "No", today: "2026-10-12" }),
    );
    expect(result.changed).toBe(false);
    expect(jira.calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("refuses to change a week that has the other result", async () => {
    const jira = weekJira();
    const update = setWeek({ kpi: "T-0", week: 1, result: "Yes", today: "2026-10-12" });
    expect(await jira.failure(update)).toContain(
      "is already No. To change it, move it back to Open",
    );
  });

  test("names the selector when no week matches", async () => {
    const jira = weekJira();
    const update = setWeek({ kpi: "T-0", week: "current", result: "Yes", today: "2027-01-01" });
    expect(await jira.failure(update)).toBe("no current week in the 4 weekly sub-tasks of T-0");
  });
});
