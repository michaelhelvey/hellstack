import type { Issue } from "./client.ts";

/** One weekly sub-task of a KPI. */
export interface Week {
  key: string;
  number: number;
  summary: string;
  /** The due date as `YYYY-MM-DD`, or null if the sub-task has no due date. */
  due: string | null;
  /** True when the week has a status in the Done category (the "Yes" status). */
  achieved: boolean;
}

/** Selects a week: a week number, the current week, or the previous week. */
export type WeekSelector = number | "current" | "previous";

/**
 * Makes weeks from the sub-tasks of a KPI. The week number comes from "Week <n>" in the summary.
 * The function ignores sub-tasks without a week number, and sorts the weeks by number.
 */
export function parseWeeks(subtasks: Issue[]): Week[] {
  return subtasks
    .flatMap((issue) => {
      const match = /\bWeek\s+(\d+)/i.exec(issue.fields.summary);
      if (!match) return [];
      return [
        {
          key: issue.key,
          number: Number(match[1]),
          summary: issue.fields.summary.trim(),
          due: issue.fields.duedate ?? null,
          achieved: issue.fields.status?.statusCategory.key === "done",
        },
      ];
    })
    .sort((a, b) => a.number - b.number);
}

/**
 * Finds the selected week. The current week is the first week with a due date on or after
 * `today`. The previous week is the last week with a due date before `today`.
 */
export function pickWeek(weeks: Week[], selector: WeekSelector, today: string): Week {
  const found =
    selector === "current"
      ? weeks.find((w) => w.due !== null && w.due >= today)
      : selector === "previous"
        ? weeks.findLast((w) => w.due !== null && w.due < today)
        : weeks.find((w) => w.number === selector);
  if (!found) throw new Error(`no ${describe(selector)} in ${weeks.length} weekly sub-tasks`);
  return found;
}

function describe(selector: WeekSelector): string {
  return typeof selector === "number" ? `week ${selector}` : `${selector} week`;
}

/** Parses a week selector from the command line: a number, `current`, or `previous`. */
export function parseSelector(value: string): WeekSelector {
  if (value === "current" || value === "previous") return value;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`--week must be a week number, "current", or "previous", not "${value}"`);
  }
  return number;
}

/**
 * Shows the weeks as one character each: `Y` for an achieved week, `N` for a past week that is not
 * achieved, and `.` for a week that is not due yet.
 */
export function weekGrid(weeks: Week[], today: string): string {
  return weeks
    .map((w) => (w.achieved ? "Y" : w.due !== null && w.due < today ? "N" : "."))
    .join("");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Gives the local date as `YYYY-MM-DD`. */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
