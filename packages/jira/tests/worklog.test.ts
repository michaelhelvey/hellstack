import { describe, expect, test } from "bun:test";
import { DateTime, Effect, Option } from "effect";
import {
  dateIn,
  formatDuration,
  jiraTime,
  logWork,
  startTime,
  workDay,
} from "../src/jira/worklog.ts";
import { fakeAtlassian, ME, routes } from "./fake.ts";

const NEW_YORK = Option.getOrThrow(DateTime.zoneMakeNamed("America/New_York"));

const start = (input: string) =>
  Effect.runPromise(Effect.map(startTime(input, NEW_YORK), jiraTime));

describe("start times", () => {
  test("a date is 09:00 on that date in the account zone", async () => {
    expect(await start("2026-11-09")).toBe("2026-11-09T09:00:00.000-0500");
  });

  test("a time without an offset is in the account zone, in summer time too", async () => {
    expect(await start("2026-07-01T13:30")).toBe("2026-07-01T13:30:00.000-0400");
  });

  test("a time with an offset keeps its instant", async () => {
    expect(await start("2026-11-09T23:30:00Z")).toBe("2026-11-09T18:30:00.000-0500");
  });

  test("fails for text that is not a time", async () => {
    const result = await Effect.runPromise(Effect.flip(startTime("monday", NEW_YORK)));
    expect(result.message).toBe('"monday" is not a date or a date and time');
  });
});

test("dateIn uses the account zone, not the offset of the worklog", () => {
  expect(dateIn("2026-11-09T23:30:00.000-0800", NEW_YORK)).toBe("2026-11-10");
  expect(dateIn("2026-11-10T01:00:00.000+0000", NEW_YORK)).toBe("2026-11-09");
  expect(dateIn("garbage", NEW_YORK)).toBeNull();
});

test("formatDuration rounds to minutes", () => {
  expect(formatDuration(0)).toBe("0m");
  expect(formatDuration(5400)).toBe("1h 30m");
  expect(formatDuration(3599)).toBe("1h");
  expect(formatDuration(120)).toBe("2m");
});

test("logWork sends the start time in the account zone and the comment as ADF", async () => {
  const jira = fakeAtlassian(
    routes({
      "GET /rest/api/3/myself": ME,
      "POST /rest/api/3/issue/PT-1/worklog": {
        id: "w1",
        timeSpentSeconds: 5400,
        started: "2026-11-09T09:00:00.000-0500",
      },
    }),
  );
  const result = await jira.run(
    logWork({ key: "PT-1", duration: "1h 30m", started: "2026-11-09", comment: "Meeting" }),
  );
  expect(result).toMatchObject({ worklogId: "w1", seconds: 5400 });
  expect(jira.calls[1]?.body).toEqual({
    timeSpent: "1h 30m",
    started: "2026-11-09T09:00:00.000-0500",
    comment: {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Meeting" }] }],
    },
  });
});

const issue = (key: string, status: string) => ({
  key,
  fields: { summary: key, status: { name: status, statusCategory: { key: "new" } } },
});

const worklog = (author: string, started: string, seconds: number) => ({
  author: { accountId: author },
  started,
  timeSpentSeconds: seconds,
});

describe("workDay", () => {
  const WORKLOGS: Record<string, unknown> = {
    "A-1": [
      worklog("me", "2026-11-09T09:00:00.000-0500", 3600),
      worklog("me", "2026-11-09T23:30:00.000-0800", 9999),
      worklog("other", "2026-11-09T10:00:00.000-0500", 9999),
    ],
    "A-2": [worklog("me", "2026-11-09T11:00:00.000-0500", 7200)],
    "A-3": [worklog("me", "2026-11-09T12:00:00.000-0500", 1800)],
    "A-4": [],
  };

  test("sums the user's worklogs on the day, and counts hidden and unresolved issues", async () => {
    const jira = fakeAtlassian((call) => {
      if (call.path === "/rest/api/3/myself") return ME;
      if (call.path === "/rest/api/3/search/jql") {
        return {
          issues: [
            issue("A-1", "To Do"),
            issue("A-2", "In Progress"),
            issue("A-3", "Accounted"),
            issue("A-4", "To Do"),
          ],
        };
      }
      return { worklogs: WORKLOGS[call.path.split("/")[5] ?? ""] };
    });
    const day = await jira.run(workDay("2026-11-09"));
    expect(day).toMatchObject({
      date: "2026-11-09",
      timeZone: "America/New_York",
      totalSeconds: 3600 + 7200 + 1800,
      total: "3h 30m",
      hidden: { count: 1, seconds: 1800 },
      unresolved: ["A-4"],
    });
    expect(day.issues.map((i) => [i.key, i.time])).toEqual([
      ["A-2", "2h"],
      ["A-1", "1h"],
    ]);
    expect(jira.calls[1]?.query["jql"]).toBe(
      'worklogAuthor = currentUser() AND worklogDate = "2026-11-09"',
    );
  });

  test("refuses a date in another format", async () => {
    const jira = fakeAtlassian(routes({ "GET /rest/api/3/myself": ME }));
    expect(await jira.failure(workDay("11/09/2026"))).toContain("YYYY-MM-DD");
  });
});
