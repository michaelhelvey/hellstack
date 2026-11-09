import { Effect } from "effect";
import { Type } from "typebox";
import { boardIssues, listBoards, listSprints } from "../jira/boards.ts";
import { opsEpics } from "../jira/ops.ts";
import { jiraTool, Nullable } from "./define.ts";
import { IssueSummary } from "./issues.ts";

const Board = Type.Integer({ description: "The board ID" });

const boards = jiraTool({
  name: "jira_boards",
  label: "Jira: boards",
  description:
    "Find Jira Software boards: one board by ID, or the boards of a project, or boards by name.",
  readOnly: true,
  parameters: Type.Object({
    id: Type.Optional(Board),
    project: Type.Optional(Type.String({ description: "A project key" })),
    name: Type.Optional(Type.String({ description: "Text in the board name" })),
  }),
  output: Type.Object({
    boards: Type.Array(
      Type.Object({
        id: Type.Integer(),
        name: Type.String(),
        type: Type.String({ description: "scrum, kanban, or simple. Only scrum has sprints." }),
        project: Nullable(Type.String()),
      }),
    ),
  }),
  run: (params) => Effect.map(listBoards(params), (list) => ({ boards: list })),
});

const SprintState = Type.Union([
  Type.Literal("active"),
  Type.Literal("future"),
  Type.Literal("closed"),
]);

const sprints = jiraTool({
  name: "jira_sprints",
  label: "Jira: sprints",
  description: "List the sprints of a scrum board. Default: the active sprint.",
  readOnly: true,
  parameters: Type.Object({
    board: Board,
    states: Type.Optional(Type.Array(SprintState, { description: 'Default: ["active"]' })),
  }),
  output: Type.Object({
    sprints: Type.Array(
      Type.Object({
        id: Type.Integer(),
        name: Type.String(),
        state: Type.String(),
        startDate: Nullable(Type.String()),
        endDate: Nullable(Type.String()),
        goal: Nullable(Type.String()),
      }),
    ),
  }),
  run: (params) =>
    Effect.map(listSprints(params.board, params.states), (list) => ({ sprints: list })),
});

const boardIssuesTool = jiraTool({
  name: "jira_board_issues",
  label: "Jira: board issues",
  description:
    "List the issues of a board. scope sprint: the open sprints of a scrum board. backlog: the backlog. open: all issues not in the Done category (use it for kanban boards). Accounted and Removed issues are left out unless includeHidden is true.",
  readOnly: true,
  parameters: Type.Object({
    board: Board,
    scope: Type.Union([Type.Literal("sprint"), Type.Literal("backlog"), Type.Literal("open")]),
    mine: Type.Optional(Type.Boolean({ description: "Only issues assigned to the user" })),
    includeHidden: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  }),
  output: Type.Object({ issues: Type.Array(IssueSummary) }),
  run: (params) => Effect.map(boardIssues(params), (issues) => ({ issues })),
});

const opsEpicsTool = jiraTool({
  name: "jira_ops_epics",
  label: "Jira: operations epics",
  description:
    "Find the open operations (ops) epics, the most relevant first. The current ops epic changes each month or quarter, so find it each time.",
  readOnly: true,
  parameters: Type.Object({}),
  output: Type.Object({
    matchedBy: Type.Union([Type.Literal("business-category"), Type.Literal("summary")], {
      description:
        'business-category: "Business Category" = Operations. summary: no epic has that value, so the epics have Operations or Ops in the summary.',
    }),
    epics: Type.Array(
      Type.Object({
        key: Type.String(),
        url: Type.String(),
        summary: Nullable(Type.String()),
        project: Nullable(Type.String()),
        boards: Type.Array(Type.String(), { description: "The boards of the project" }),
        status: Nullable(Type.String()),
        created: Nullable(Type.String()),
        myOpsIssues30d: Type.Integer({
          description: "Issues under the epic that the user logged time to in the last 30 days",
        }),
        myProjectIssues60d: Type.Integer({
          description: "Issues in the project that the user worked on in the last 60 days",
        }),
      }),
    ),
  }),
  run: opsEpics,
});

/** The tools for boards, sprints, and operations epics. */
export const BOARD_TOOLS = [boards, sprints, boardIssuesTool, opsEpicsTool];
