import type { Issue } from "../schemas.ts";
import { nameOf, orNull } from "../search.ts";

/** The result of a week: "Yes" when the KPI target was achieved, else "No". */
export type Outcome = "Yes" | "No";

/** One weekly sub-task of a KPI. */
export interface Week {
  readonly key: string;
  readonly number: number;
  readonly summary: string;
  /** The due date as `YYYY-MM-DD`, or null if the sub-task has no due date. */
  readonly due: string | null;
  /** The status name, for example "Open", "Yes", or "No". */
  readonly status: string | null;
  /**
   * The result of the week, or null when it is not set (for example "Open"). The result comes from
   * the status name. "Yes" and "No" are both in the Done category, so the category cannot tell
   * them apart.
   */
  readonly result: Outcome | null;
}

/** Selects a week: a week number, the current week, or the previous week. */
export type WeekSelector = number | "current" | "previous";

const OUTCOMES: ReadonlyArray<Outcome> = ["Yes", "No"];

/** The outcome that a status name stands for, or null. */
export const outcomeOf = (status: string | null): Outcome | null =>
  OUTCOMES.find((outcome) => outcome.toLowerCase() === status?.trim().toLowerCase()) ?? null;

const toWeek = ({ key, fields }: Issue): ReadonlyArray<Week> => {
  const summary = (fields.summary ?? "").trim();
  const number = /\bWeek\s+(\d+)/i.exec(summary)?.[1];
  const status = nameOf(fields.status);
  return number === undefined
    ? []
    : [
        {
          key,
          number: Number(number),
          summary,
          due: orNull(fields.duedate),
          status,
          result: outcomeOf(status),
        },
      ];
};

/**
 * Makes weeks from the sub-tasks of a KPI. The week number comes from "Week <n>" in the summary.
 * The function ignores sub-tasks without a week number, and sorts the weeks by number.
 */
export const parseWeeks = (subtasks: ReadonlyArray<Issue>): ReadonlyArray<Week> =>
  subtasks.flatMap(toWeek).toSorted((a, b) => a.number - b.number);

const dueFrom = (today: string) => (week: Week) => week.due !== null && week.due >= today;

const dueBefore = (today: string) => (week: Week) => week.due !== null && week.due < today;

/**
 * Finds the selected week, or undefined. The current week is the first week with a due date on or
 * after `today`. The previous week is the last week with a due date before `today`.
 */
export const pickWeek = <W extends Week>(
  weeks: ReadonlyArray<W>,
  selector: WeekSelector,
  today: string,
): W | undefined => {
  if (selector === "current") return weeks.find(dueFrom(today));
  if (selector === "previous") return weeks.findLast(dueBefore(today));
  return weeks.find((week) => week.number === selector);
};

/** Describes a week selector for messages, for example "week 3" or "current week". */
export const describeSelector = (selector: WeekSelector) =>
  typeof selector === "number" ? `week ${selector}` : `${selector} week`;

const GRID: Readonly<Record<Outcome, string>> = { Yes: "Y", No: "N" };

/**
 * Shows the weeks as one character each: `Y` (Yes), `N` (No), `!` (a past week without a result),
 * and `.` (not due yet).
 */
export const weekGrid = (weeks: ReadonlyArray<Week>, today: string) =>
  weeks
    .map((week) =>
      week.result === null ? (dueBefore(today)(week) ? "!" : ".") : GRID[week.result],
    )
    .join("");

const DAY = 24 * 60 * 60 * 1000;

const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Gives `count` due dates, one week apart, from the first due date (`YYYY-MM-DD`). */
export const weeklyDueDates = (first: string, count: number): ReadonlyArray<string> => {
  const start = Date.parse(`${first}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => isoDate(start + index * 7 * DAY));
};

const FRIDAY = 5;

/** Gives the first Friday on or after the first day of the quarter of `today` (`YYYY-MM-DD`). */
export const quarterFirstFriday = (today: string) => {
  const [year = 0, month = 1] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, Math.floor((month - 1) / 3) * 3, 1));
  return isoDate(start.getTime() + ((FRIDAY - start.getUTCDay() + 7) % 7) * DAY);
};
