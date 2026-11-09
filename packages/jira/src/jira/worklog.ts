import { DateTime, Effect, Option, Schema } from "effect";
import { textToAdf } from "../adf.ts";
import { AtlassianError, call, get } from "../atlassian.ts";
import { myself } from "./issues.ts";
import { list, nullable, type Myself } from "./schemas.ts";
import { isHiddenStatus, search, site, summarize, type IssueSummary } from "./search.ts";

const fail = (message: string) => Effect.fail(new AtlassianError({ message }));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/** The time zone of the Jira account. JQL `worklogDate` uses this zone. */
export const accountZone = (me: Myself) =>
  Option.match(DateTime.zoneMakeNamed(me.timeZone ?? "UTC"), {
    onNone: () => fail(`unknown time zone "${me.timeZone}" in the Jira account`),
    onSome: Effect.succeed,
  });

const local = (input: string, zone: DateTime.TimeZone) =>
  DateTime.makeZoned(DATE.test(input) ? `${input}T09:00:00` : input, {
    timeZone: zone,
    adjustForTimeZone: true,
  });

const absolute = (input: string, zone: DateTime.TimeZone) =>
  Option.map(DateTime.make(input), (time) => DateTime.setZone(time, zone));

/**
 * Finds the start time of a worklog. Without input, it is now. A date without a time is 09:00 on
 * that date. A time without an offset is in the time zone of the account.
 */
export const startTime = (input: string | undefined, zone: DateTime.TimeZone) =>
  input === undefined
    ? Effect.map(DateTime.now, (now) => DateTime.setZone(now, zone))
    : Option.match((OFFSET.test(input) ? absolute : local)(input, zone), {
        onNone: () => fail(`"${input}" is not a date or a date and time`),
        onSome: Effect.succeed,
      });

/** Formats a time as Jira wants it for a worklog: `2026-11-09T09:00:00.000-0500`. */
export const jiraTime = (time: DateTime.Zoned) =>
  DateTime.formatIsoOffset(time).replace(/([+-]\d{2}):(\d{2})$/, "$1$2");

const CreatedWorklog = Schema.Struct({
  id: Schema.String,
  timeSpentSeconds: Schema.Int,
  started: Schema.String,
});

/** The input of {@link logWork}. */
export interface WorkInput {
  readonly key: string;
  /** Time in Jira duration format, for example `1h 30m`. */
  readonly duration: string;
  /** `YYYY-MM-DD`, a local date and time, or an ISO time with an offset. Default: now. */
  readonly started?: string | undefined;
  readonly comment?: string | undefined;
}

/** Logs time on an issue. Times without an offset use the time zone of the Jira account. */
export const logWork = Effect.fnUntraced(function* (input: WorkInput) {
  const zone = yield* accountZone(yield* myself);
  const started = jiraTime(yield* startTime(input.started, zone));
  const comment = input.comment === undefined ? {} : { comment: textToAdf(input.comment) };
  const worklog = yield* call(CreatedWorklog, {
    method: "POST",
    path: `/rest/api/3/issue/${input.key}/worklog`,
    body: { timeSpent: input.duration, started, ...comment },
  });
  return {
    key: input.key,
    url: `${yield* site}/browse/${input.key}`,
    worklogId: worklog.id,
    seconds: worklog.timeSpentSeconds,
    started: worklog.started,
  };
});

/** Formats seconds as hours and minutes, for example `1h 30m`. */
export const formatDuration = (seconds: number) => {
  const minutes = Math.round(Math.max(seconds, 0) / 60);
  const parts = [[Math.floor(minutes / 60), "h"] as const, [minutes % 60, "m"] as const]
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`);
  return parts.join(" ") || "0m";
};

const Worklogs = Schema.Struct({
  worklogs: list(
    Schema.Struct({
      author: nullable(Schema.Struct({ accountId: Schema.String })),
      started: Schema.String,
      timeSpentSeconds: Schema.Int,
    }),
  ),
});

type Worklog = (typeof Worklogs.Type)["worklogs"][number];

/** The date of a worklog start time in the zone, as `YYYY-MM-DD`, or null if it is not a time. */
export const dateIn = (started: string, zone: DateTime.TimeZone) =>
  Option.getOrNull(
    Option.map(
      absolute(started.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"), zone),
      DateTime.formatIsoDate,
    ),
  );

/** The time on one issue in a {@link WorkDay}. */
export interface IssueTime extends IssueSummary {
  readonly seconds: number;
  /** The time as hours and minutes, for example `1h 30m`. */
  readonly time: string;
}

/** The time that the user logged on one day. */
export interface WorkDay {
  readonly date: string;
  readonly timeZone: string;
  readonly totalSeconds: number;
  readonly total: string;
  /** The issues with time on this day, most time first. Accounted and Removed issues are not here. */
  readonly issues: ReadonlyArray<IssueTime>;
  /** The Accounted and Removed issues with time on this day. The total includes them. */
  readonly hidden: { readonly count: number; readonly seconds: number };
  /**
   * Issues that JQL finds for this day, but with no matching worklog. The total can be too low
   * when this is not empty.
   */
  readonly unresolved: ReadonlyArray<string>;
}

const mine = (worklog: Worklog, me: Myself, date: string, zone: DateTime.TimeZone) =>
  worklog.author?.accountId === me.accountId && dateIn(worklog.started, zone) === date;

const sum = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0);

const byTime = (a: IssueTime, b: IssueTime) => b.seconds - a.seconds || a.key.localeCompare(b.key);

const report = (date: string, timeZone: string, rows: ReadonlyArray<IssueTime>): WorkDay => {
  const logged = rows.filter((row) => row.seconds > 0);
  const hidden = logged.filter((row) => isHiddenStatus(row.status ?? undefined));
  const totalSeconds = sum(logged.map((row) => row.seconds));
  return {
    date,
    timeZone,
    totalSeconds,
    total: formatDuration(totalSeconds),
    issues: logged.filter((row) => !hidden.includes(row)).toSorted(byTime),
    hidden: { count: hidden.length, seconds: sum(hidden.map((row) => row.seconds)) },
    unresolved: rows.filter((row) => row.seconds <= 0).map((row) => row.key),
  };
};

const today = (zone: DateTime.TimeZone) =>
  Effect.map(DateTime.now, (now) => DateTime.formatIsoDate(DateTime.setZone(now, zone)));

/**
 * Finds the issues that the user logged time to on one day, and the time on each. The day uses
 * the time zone of the Jira account, as JQL does. Default: today.
 */
export const workDay = Effect.fnUntraced(function* (date?: string) {
  const me = yield* myself;
  const zone = yield* accountZone(me);
  const day = date ?? (yield* today(zone));
  if (!DATE.test(day)) return yield* fail(`"${day}" is not a date in the format YYYY-MM-DD`);
  const url = yield* site;
  const issues = yield* search(`worklogAuthor = currentUser() AND worklogDate = "${day}"`, [
    "summary",
    "status",
    "issuetype",
    "parent",
  ]);
  const rows = yield* Effect.forEach(
    issues,
    (issue) =>
      Effect.map(
        get(Worklogs, `/rest/api/3/issue/${issue.key}/worklog`, { maxResults: 5000 }),
        ({ worklogs }): IssueTime => {
          const seconds = sum(
            worklogs.filter((w) => mine(w, me, day, zone)).map((w) => w.timeSpentSeconds),
          );
          return { ...summarize(url, issue), seconds, time: formatDuration(seconds) };
        },
      ),
    { concurrency: 8 },
  );
  return report(day, DateTime.zoneToString(zone), rows);
});
