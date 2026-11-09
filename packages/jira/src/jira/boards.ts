import { Effect, Schema } from "effect";
import { type ApiRequest, Atlassian, AtlassianError, get } from "../atlassian.ts";
import { nullable } from "./schemas.ts";
import { Issue } from "./schemas.ts";
import { isHiddenStatus, site, summarize, SUMMARY_FIELDS, type IssueSummary } from "./search.ts";

const PAGE_SIZE = 50;

type Query = NonNullable<ApiRequest["query"]>;

const AgilePage = <S extends Schema.Top>(item: S) =>
  Schema.Struct({
    startAt: Schema.Int,
    isLast: Schema.optional(Schema.Boolean),
    total: Schema.optional(Schema.Int),
    values: Schema.optional(Schema.Array(item)),
    issues: Schema.optional(Schema.Array(item)),
  });

type Page<A> = {
  readonly isLast?: boolean | undefined;
  readonly total?: number | undefined;
  readonly values?: ReadonlyArray<A> | undefined;
  readonly issues?: ReadonlyArray<A> | undefined;
};

const itemsOf = <A>(page: Page<A>): ReadonlyArray<A> => page.values ?? page.issues ?? [];

const isLastPage = <A>(page: Page<A>, next: number) =>
  itemsOf(page).length === 0 || page.isLast === true || next >= (page.total ?? Infinity);

/**
 * Gets all pages of an Agile API list, up to `limit` items. The list is in `values` (boards and
 * sprints) or in `issues`.
 */
const agileList = <S extends Schema.Top>(
  item: S,
  path: string,
  query: Query,
  limit = Infinity,
  startAt = 0,
): Effect.Effect<ReadonlyArray<S["Type"]>, AtlassianError, Atlassian | S["DecodingServices"]> =>
  Effect.flatMap(
    get(AgilePage(item), path, { ...query, startAt, maxResults: PAGE_SIZE }),
    (page) => {
      const items = itemsOf(page);
      const next = startAt + items.length;
      return isLastPage(page, next) || next >= limit
        ? Effect.succeed(items.slice(0, limit))
        : Effect.map(agileList(item, path, query, limit - items.length, next), (more) => [
            ...items,
            ...more,
          ]);
    },
  );

const Board = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  type: Schema.String,
  location: Schema.optional(Schema.Struct({ projectKey: Schema.optional(Schema.String) })),
});

/** A Jira Software board. */
export interface BoardInfo {
  readonly id: number;
  readonly name: string;
  /** `scrum`, `kanban`, or `simple`. Only scrum boards have sprints. */
  readonly type: string;
  readonly project: string | null;
}

const toBoard = (board: typeof Board.Type): BoardInfo => ({
  id: board.id,
  name: board.name,
  type: board.type,
  project: board.location?.projectKey ?? null,
});

/** The filters of {@link listBoards}. */
export interface BoardFilter {
  readonly id?: number | undefined;
  readonly project?: string | undefined;
  readonly name?: string | undefined;
}

const boardQuery = (filter: BoardFilter): Query => ({
  ...(filter.project === undefined ? {} : { projectKeyOrId: filter.project }),
  ...(filter.name === undefined ? {} : { name: filter.name }),
});

/** Finds boards: one board by ID, or all boards, with an optional project and name filter. */
export const listBoards = (filter: BoardFilter = {}) =>
  Effect.map(
    filter.id === undefined
      ? agileList(Board, "/rest/agile/1.0/board", boardQuery(filter))
      : Effect.map(get(Board, `/rest/agile/1.0/board/${filter.id}`), (board) => [board]),
    (boards) => boards.map(toBoard),
  );

const Sprint = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  state: Schema.String,
  startDate: nullable(Schema.String),
  endDate: nullable(Schema.String),
  goal: nullable(Schema.String),
});

/** A sprint of a scrum board. */
export type SprintInfo = typeof Sprint.Type;

/** The states of a sprint. */
export type SprintState = "active" | "future" | "closed";

/** Lists the sprints of a scrum board in the given states. */
export const listSprints = (board: number, states: ReadonlyArray<SprintState> = ["active"]) =>
  agileList(Sprint, `/rest/agile/1.0/board/${board}/sprint`, { state: states.join(",") });

/** Which issues of a board {@link boardIssues} gets. */
export type BoardScope = "sprint" | "backlog" | "open";

/** The input of {@link boardIssues}. */
export interface BoardIssuesInput {
  readonly board: number;
  /**
   * `sprint`: the issues in the open sprints. `backlog`: the backlog. `open`: all issues that are
   * not in the Done category (use this for kanban boards).
   */
  readonly scope: BoardScope;
  /** Only issues that are assigned to the user. */
  readonly mine?: boolean | undefined;
  /** Also give Accounted and Removed issues. */
  readonly includeHidden?: boolean | undefined;
  readonly limit?: number | undefined;
}

const SCOPES: Readonly<Record<BoardScope, { readonly path: string; readonly jql: string }>> = {
  sprint: { path: "issue", jql: "sprint in openSprints()" },
  backlog: { path: "backlog", jql: "" },
  open: { path: "issue", jql: "statusCategory != Done" },
};

const boardJql = (input: BoardIssuesInput) =>
  [SCOPES[input.scope].jql, input.mine === true ? "assignee = currentUser()" : ""]
    .filter((clause) => clause !== "")
    .join(" AND ");

/** Gets the issues of a board. Accounted and Removed issues are not included by default. */
export const boardIssues = Effect.fnUntraced(function* (input: BoardIssuesInput) {
  const jql = boardJql(input);
  const issues = yield* agileList(
    Issue,
    `/rest/agile/1.0/board/${input.board}/${SCOPES[input.scope].path}`,
    { fields: SUMMARY_FIELDS.join(","), ...(jql === "" ? {} : { jql }) },
    input.limit,
  );
  const url = yield* site;
  return issues
    .map((issue): IssueSummary => summarize(url, issue))
    .filter((issue) => input.includeHidden === true || !isHiddenStatus(issue.status ?? undefined));
});
