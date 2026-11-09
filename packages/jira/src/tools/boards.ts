import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { boardIssues, listBoards, listSprints } from "../jira/boards.ts";
import { opsEpics } from "../jira/ops.ts";
import { jiraTool, READS } from "./define.ts";
import { IssueSummary } from "./issues.ts";

const Board = Schema.Int.annotate({ description: "The board ID" });

const NullableString = Schema.NullOr(Schema.String);

const Boards = jiraTool("boards", {
  description:
    "Find Jira Software boards: one board by ID, or the boards of a project, or boards by name.",
  hints: READS,
  parameters: Schema.Struct({
    id: Schema.optionalKey(Board),
    project: Schema.optionalKey(Schema.String.annotate({ description: "A project key" })),
    name: Schema.optionalKey(Schema.String.annotate({ description: "Text in the board name" })),
  }),
  success: Schema.Struct({
    boards: Schema.Array(
      Schema.Struct({
        id: Schema.Int,
        name: Schema.String,
        type: Schema.String.annotate({
          description: "scrum, kanban, or simple. Only scrum has sprints.",
        }),
        project: NullableString,
      }),
    ),
  }),
});

const Sprints = jiraTool("sprints", {
  description: "List the sprints of a scrum board. Default: the active sprint.",
  hints: READS,
  parameters: Schema.Struct({
    board: Board,
    states: Schema.optionalKey(
      Schema.Array(Schema.Literals(["active", "future", "closed"])).annotate({
        description: 'Default: ["active"]',
      }),
    ),
  }),
  success: Schema.Struct({
    sprints: Schema.Array(
      Schema.Struct({
        id: Schema.Int,
        name: Schema.String,
        state: Schema.String,
        startDate: NullableString,
        endDate: NullableString,
        goal: NullableString,
      }),
    ),
  }),
});

const BoardIssues = jiraTool("board_issues", {
  description:
    "List the issues of a board. scope sprint: the open sprints of a scrum board. backlog: the backlog. open: all issues not in the Done category (use it for kanban boards). Accounted and Removed issues are left out unless includeHidden is true.",
  hints: READS,
  parameters: Schema.Struct({
    board: Board,
    scope: Schema.Literals(["sprint", "backlog", "open"]),
    mine: Schema.optionalKey(
      Schema.Boolean.annotate({ description: "Only issues assigned to the user" }),
    ),
    includeHidden: Schema.optionalKey(Schema.Boolean),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  }),
  success: Schema.Struct({ issues: Schema.Array(IssueSummary) }),
});

const OpsEpics = jiraTool("ops_epics", {
  description:
    "Find the open operations (ops) epics, the most relevant first. The current ops epic changes each month or quarter, so find it each time.",
  hints: READS,
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    matchedBy: Schema.Literals(["business-category", "summary"]).annotate({
      description:
        'business-category: "Business Category" = Operations. summary: no epic has that value, so the epics have Operations or Ops in the summary.',
    }),
    epics: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        url: Schema.String,
        summary: NullableString,
        project: NullableString,
        boards: Schema.Array(Schema.String).annotate({
          description: "The boards of the project",
        }),
        status: NullableString,
        created: NullableString,
        myOpsIssues30d: Schema.Int.annotate({
          description: "Issues under the epic that the user logged time to in the last 30 days",
        }),
        myProjectIssues60d: Schema.Int.annotate({
          description: "Issues in the project that the user worked on in the last 60 days",
        }),
      }),
    ),
  }),
});

/** The tools for boards, sprints, and operations epics. */
export const BoardTools = Toolkit.make(Boards, Sprints, BoardIssues, OpsEpics);

/** The handlers of {@link BoardTools}. */
export const BoardHandlers = BoardTools.toLayer({
  boards: (params) => Effect.map(listBoards(params), (boards) => ({ boards })),
  sprints: (params) =>
    Effect.map(listSprints(params.board, params.states), (sprints) => ({ sprints })),
  board_issues: (params) => Effect.map(boardIssues(params), (issues) => ({ issues })),
  ops_epics: () => opsEpics(),
});
