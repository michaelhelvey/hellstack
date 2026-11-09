import { Effect } from "effect";
import { listBoards } from "./boards.ts";
import type { Issue } from "./schemas.ts";
import { issueUrl, keyOf, nameOf, orNull, search, site } from "./search.ts";

const OPEN_EPICS = "issuetype = Epic AND statusCategory != Done";
const EPIC_FIELDS = ["summary", "status", "created", "project"];

/** An open operations epic, with numbers that show how relevant it is to the user. */
export interface OpsEpic {
  readonly key: string;
  readonly url: string;
  readonly summary: string | null;
  readonly project: string | null;
  /** The names of the boards of the project. */
  readonly boards: ReadonlyArray<string>;
  readonly status: string | null;
  readonly created: string | null;
  /** The issues under the epic that the user logged time to in the last 30 days. */
  readonly myOpsIssues30d: number;
  /** The issues in the project that the user worked on in the last 60 days. */
  readonly myProjectIssues60d: number;
}

/** The result of {@link opsEpics}. */
export interface OpsEpics {
  /**
   * `business-category`: the epics have "Business Category" = Operations. `summary`: no epic has
   * that value, so the epics have "Operations" or "Ops" in the summary.
   */
  readonly matchedBy: "business-category" | "summary";
  /** The most relevant epic first. */
  readonly epics: ReadonlyArray<OpsEpic>;
}

const byCategory = search(`${OPEN_EPICS} AND "Business Category" = Operations`, EPIC_FIELDS).pipe(
  Effect.orElseSucceed((): ReadonlyArray<Issue> => []),
);

const bySummary = search(
  `${OPEN_EPICS} AND (summary ~ "Operations" OR summary ~ "Ops")`,
  EPIC_FIELDS,
);

const countBy = (values: ReadonlyArray<string | null>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

const createdOf = (epic: OpsEpic) => epic.created ?? "";

const relevance = (a: OpsEpic, b: OpsEpic) =>
  b.myOpsIssues30d - a.myOpsIssues30d ||
  b.myProjectIssues60d - a.myProjectIssues60d ||
  createdOf(a).localeCompare(createdOf(b));

const lookup = <A>(map: ReadonlyMap<string, A>, key: string | null, fallback: A) =>
  key === null ? fallback : (map.get(key) ?? fallback);

interface Activity {
  readonly url: string;
  readonly ops: ReadonlyMap<string, number>;
  readonly active: ReadonlyMap<string, number>;
  readonly boards: ReadonlyMap<string, ReadonlyArray<string>>;
}

const toOpsEpic =
  ({ url, ops, active, boards }: Activity) =>
  (epic: Issue): OpsEpic => {
    const project = keyOf(epic.fields.project);
    return {
      key: epic.key,
      url: issueUrl(url, epic.key),
      summary: orNull(epic.fields.summary),
      project,
      boards: lookup(boards, project, []),
      status: nameOf(epic.fields.status),
      created: orNull(epic.fields.created?.slice(0, 10)),
      myOpsIssues30d: lookup(ops, epic.key, 0),
      myProjectIssues60d: lookup(active, project, 0),
    };
  };

const boardNames = Effect.map(listBoards(), (boards) => {
  const names = new Map<string, Array<string>>();
  for (const board of boards) {
    if (board.project !== null)
      names.set(board.project, [...(names.get(board.project) ?? []), board.name]);
  }
  return names;
});

const relevant = Effect.fnUntraced(function* (epics: ReadonlyArray<Issue>) {
  const keys = epics.map((epic) => epic.key).join(",");
  const [mine, activity, boards, url] = yield* Effect.all(
    [
      search(`worklogAuthor = currentUser() AND worklogDate >= -30d AND parent in (${keys})`, [
        "parent",
      ]),
      search(
        "(worklogAuthor = currentUser() AND worklogDate >= -60d) OR (assignee = currentUser() AND updated >= -60d)",
        ["project"],
      ),
      boardNames,
      site,
    ],
    { concurrency: "unbounded" },
  );
  const ops = countBy(mine.map((issue) => keyOf(issue.fields.parent)));
  const active = countBy(activity.map((issue) => keyOf(issue.fields.project)));
  return epics.map(toOpsEpic({ url, ops, active, boards })).toSorted(relevance);
});

/**
 * Finds the open operations epics, with the most relevant epic first. An operations epic is an
 * open Epic with "Business Category" = Operations. If no epic has that value, it uses the open
 * epics with "Operations" or "Ops" in the summary.
 */
export const opsEpics = Effect.fnUntraced(function* () {
  const categorized = yield* byCategory;
  const matchedBy = categorized.length > 0 ? "business-category" : "summary";
  const epics = categorized.length > 0 ? categorized : yield* bySummary;
  const result: OpsEpics = {
    matchedBy,
    epics: epics.length === 0 ? [] : yield* relevant(epics),
  };
  return result;
});
