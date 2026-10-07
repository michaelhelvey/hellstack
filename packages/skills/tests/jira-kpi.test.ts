import { describe, expect, test } from "bun:test";

import {
  createKpi,
  findTemplate,
  formatKpis,
  loadContext,
  setWeek,
} from "../skills/jira/scripts/lib/kpi/actions.ts";
import type { Issue, Jira } from "../skills/jira/scripts/lib/kpi/client.ts";
import {
  parseSelector,
  parseWeeks,
  pickWeek,
  weekGrid,
} from "../skills/jira/scripts/lib/kpi/weeks.ts";

const SUBTASK = { id: "5", name: "Sub-task", subtask: true, hierarchyLevel: -1 };
const TASK = { id: "4", name: "Task", subtask: false, hierarchyLevel: 0 };

function week(key: string, n: number, due: string, done = false, summary = `Week ${n}`): Issue {
  const category = done ? "done" : "new";
  return {
    key,
    fields: {
      summary,
      duedate: due,
      issuetype: SUBTASK,
      status: { name: done ? "Yes" : "No", statusCategory: { key: category } },
    },
  };
}

const WEEKS = [
  week("T-3", 3, "2026-10-16"),
  week("T-1", 1, "2026-10-02", true),
  week("T-2", 2, "2026-10-09"),
];

interface Call {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string> | undefined;
}

/** Gives the message of the error that the promise rejects with. */
async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof Error ? error.message : "no error";
}

/** Makes a fake client. `respond` gives the response for each request. */
function fakeJira(respond: (call: Call) => unknown): { jira: Jira; calls: Call[] } {
  const calls: Call[] = [];
  function handle(call: Call): Promise<unknown> {
    calls.push(call);
    return Promise.resolve(respond(call));
  }
  return {
    calls,
    jira: {
      get: (path, query) => handle({ method: "GET", path, query }),
      send: (method, path, body) => handle({ method, path, body }),
    },
  };
}

function transitions(): unknown {
  return {
    transitions: [
      {
        id: "11",
        name: "Start",
        to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      },
      { id: "21", name: "KPI Completed", to: { name: "Yes", statusCategory: { key: "done" } } },
    ],
  };
}

describe("weeks", () => {
  test("parses week numbers from cloned summaries and sorts by number", () => {
    const weeks = parseWeeks([...WEEKS, week("T-9", 9, "2026-11-27", false, "CLONE - Week 10")]);
    expect(weeks.map((w) => [w.number, w.key, w.achieved])).toEqual([
      [1, "T-1", true],
      [2, "T-2", false],
      [3, "T-3", false],
      [10, "T-9", false],
    ]);
  });

  test("ignores sub-tasks without a week number", () => {
    expect(parseWeeks([week("X-1", 1, "2026-10-02", false, "Notes")])).toEqual([]);
  });

  test("the current week is the first week due on or after today", () => {
    const weeks = parseWeeks(WEEKS);
    expect(pickWeek(weeks, "current", "2026-10-07").number).toBe(2);
    expect(pickWeek(weeks, "current", "2026-10-09").number).toBe(2);
    expect(pickWeek(weeks, "current", "2026-10-10").number).toBe(3);
  });

  test("the previous week is the last week due before today", () => {
    expect(pickWeek(parseWeeks(WEEKS), "previous", "2026-10-12").number).toBe(2);
  });

  test("fails when no week matches", () => {
    expect(() => pickWeek(parseWeeks(WEEKS), "current", "2027-01-01")).toThrow("no current week");
    expect(() => pickWeek(parseWeeks(WEEKS), 7, "2026-10-01")).toThrow("no week 7");
  });

  test("parses week selectors", () => {
    expect(parseSelector("4")).toBe(4);
    expect(parseSelector("previous")).toBe("previous");
    expect(() => parseSelector("0")).toThrow("--week");
    expect(() => parseSelector("last")).toThrow("--week");
  });

  test("the grid marks achieved, missed, and future weeks", () => {
    expect(weekGrid(parseWeeks(WEEKS), "2026-10-12")).toBe("YN.");
  });
});

describe("findTemplate", () => {
  function search(issues: Issue[]) {
    return fakeJira((call) =>
      call.path === "/rest/api/3/search/jql"
        ? { issues }
        : { key: "S-21", fields: { summary: "t" } },
    );
  }

  function template(key: string, summary: string): Issue {
    return { key, fields: { summary, issuetype: TASK } };
  }

  test("uses the one issue whose summary has the phrase", async () => {
    const { jira, calls } = search([
      template("S-21", "Template Individual KPI (Type item here)"),
      template("S-94", "Template - Individual"),
    ]);
    await findTemplate(jira, { summary: "Template Individual KPI" });
    expect(calls.at(-1)?.path).toBe("/rest/api/3/issue/S-21");
  });

  test("fails and lists the keys when more than one issue matches", async () => {
    const { jira } = search([
      template("S-21", "Template Individual KPI"),
      template("S-40", "Old Template Individual KPI"),
    ]);
    const found = findTemplate(jira, { summary: "Template Individual KPI" });
    expect(await failure(found)).toContain("S-21 (Template Individual KPI), S-40");
  });

  test("uses the key from the options without a search", async () => {
    const { jira, calls } = search([]);
    await findTemplate(jira, { key: "S-21", summary: "unused" });
    expect(calls.map((c) => c.path)).toEqual(["/rest/api/3/issue/S-21"]);
  });
});

describe("createKpi", () => {
  test("copies the template weeks under a new KPI and moves the KPI to In Progress", async () => {
    const { jira, calls } = fakeJira((call) => {
      if (call.path === "/rest/api/3/issue/S-21") {
        return {
          key: "S-21",
          fields: {
            summary: "Template",
            project: { key: "S" },
            issuetype: TASK,
            description: null,
          },
        };
      }
      if (call.path === "/rest/api/3/search/jql") return { issues: WEEKS };
      if (call.path === "/rest/api/3/myself") return { accountId: "me" };
      if (call.path === "/rest/api/3/issue") return { key: "S-100" };
      if (call.path === "/rest/api/3/issue/bulk") return { issues: [{ key: "S-101" }], errors: [] };
      if (call.path.endsWith("/transitions")) return call.method === "GET" ? transitions() : null;
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    const context = await loadContext(jira, { key: "S-21", summary: "" });

    const created = await createKpi(jira, context, { summary: "Ship it", rock: "S-7" });

    expect(created).toEqual({ key: "S-100", weeks: ["S-101"], status: "In Progress" });
    const sent = calls.filter((c) => c.method === "POST");
    expect(sent.map((c) => c.path)).toEqual([
      "/rest/api/3/issue",
      "/rest/api/3/issue/bulk",
      "/rest/api/3/issue/S-100/transitions",
    ]);
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
            summary: "Week 1",
            duedate: "2026-10-02",
            issuetype: { id: "5" },
          },
        },
        { fields: { summary: "Week 2", duedate: "2026-10-09", assignee: { accountId: "me" } } },
        { fields: { summary: "Week 3", duedate: "2026-10-16" } },
      ],
    });
    expect(sent[2]?.body).toEqual({ transition: { id: "11" } });
  });

  test("reports the new KPI key when a weekly sub-task fails", async () => {
    const { jira } = fakeJira((call) =>
      call.path === "/rest/api/3/issue/bulk"
        ? { issues: [], errors: [{ status: 400 }] }
        : { key: "S-100", accountId: "me" },
    );
    const context = {
      template: { key: "S-21", fields: { summary: "t", project: { key: "S" }, issuetype: TASK } },
      project: "S",
      weeks: parseWeeks(WEEKS),
      subtaskTypeId: "5",
    };
    expect(await failure(createKpi(jira, context, { summary: "x", rock: "S-7" }))).toContain(
      "created S-100, but some weekly sub-tasks failed",
    );
  });
});

describe("setWeek", () => {
  function weekJira() {
    return fakeJira((call) => {
      if (call.path === "/rest/api/3/search/jql") return { issues: WEEKS };
      if (call.path.endsWith("/transitions")) return call.method === "GET" ? transitions() : null;
      return null;
    });
  }

  test("moves the current week to Yes and adds the comment", async () => {
    const { jira, calls } = weekJira();
    const result = await setWeek(jira, {
      kpi: "T-0",
      week: "current",
      achieved: true,
      comment: "Done.\n\nNext step.",
      today: "2026-10-07",
    });
    expect(result.changed).toBe(true);
    expect(result.week.key).toBe("T-2");
    const sent = calls.filter((c) => c.method === "POST");
    expect(sent.map((c) => [c.path, c.body])).toEqual([
      ["/rest/api/3/issue/T-2/transitions", { transition: { id: "21" } }],
      [
        "/rest/api/3/issue/T-2/comment",
        {
          body: {
            type: "doc",
            version: 1,
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Done." }] },
              { type: "paragraph", content: [{ type: "text", text: "Next step." }] },
            ],
          },
        },
      ],
    ]);
  });

  test("does not change a week that already has the result", async () => {
    const { jira, calls } = weekJira();
    const result = await setWeek(jira, {
      kpi: "T-0",
      week: 2,
      achieved: false,
      today: "2026-10-07",
    });
    expect(result.changed).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("refuses to move a Yes week back to No", async () => {
    const { jira } = weekJira();
    const update = setWeek(jira, { kpi: "T-0", week: 1, achieved: false, today: "2026-10-07" });
    expect(await failure(update)).toContain("cannot move it back to No");
  });
});

test("formatKpis shows the current week and the grid for each KPI", () => {
  const issue: Issue = {
    key: "S-100",
    fields: {
      summary: "Ship it",
      status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      parent: { key: "S-7" },
    },
  };
  const output = formatKpis([{ issue, weeks: parseWeeks(WEEKS) }], "2026-10-12");
  expect(output.split("\n")).toEqual([
    "kpi\tstatus\trock\tthis_week\tweeks\tsummary",
    "S-100\tIn Progress\tS-7\t3:No\tYN.\tShip it",
  ]);
});
