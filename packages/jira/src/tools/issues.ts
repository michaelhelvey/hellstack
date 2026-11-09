import { Effect } from "effect";
import { Type } from "typebox";
import { request } from "../atlassian.ts";
import {
  addComment,
  createIssue,
  listFields,
  myself,
  readIssue,
  transitionIssue,
  updateIssue,
} from "../jira/issues.ts";
import { searchIssues, site } from "../jira/search.ts";
import { logWork, workDay } from "../jira/worklog.ts";
import { jiraTool, Nullable } from "./define.ts";

const IssueSummaryProperties = {
  key: Type.String(),
  url: Type.String(),
  summary: Nullable(Type.String()),
  type: Nullable(Type.String()),
  status: Nullable(Type.String()),
  statusCategory: Nullable(
    Type.String({ description: "new (To Do), indeterminate (In Progress), or done" }),
  ),
  assignee: Nullable(Type.String()),
  priority: Nullable(Type.String()),
  parent: Nullable(Type.String({ description: "The key of the parent issue" })),
  project: Nullable(Type.String()),
  updated: Nullable(Type.String()),
};

/** The short view of an issue. */
export const IssueSummary = Type.Object(IssueSummaryProperties);

const IssueRef = Type.Object({ key: Type.String(), url: Type.String() });

const Key = Type.String({ description: "The issue key, for example ABC-123" });

const Duration = (description: string) => Type.String({ description });

const FieldValues = Type.Record(Type.String(), Type.Unknown(), {
  description:
    'Other fields, by field ID or field name. Values use the REST API format, for example { "Story Points": 3 }. Fields that project managers set (Business Category, Operations Category, Complete Work Sprint, CWIP) are refused.',
});

const ChangeProperties = {
  description: Type.Optional(
    Type.String({ description: "Plain text. Blank lines separate paragraphs." }),
  ),
  parent: Type.Optional(
    Type.String({ description: "The key of the parent issue, for example an epic" }),
  ),
  estimate: Type.Optional(Duration("Original estimate in Jira duration format, for example 10h")),
  fields: Type.Optional(FieldValues),
};

const whoami = jiraTool({
  name: "jira_whoami",
  label: "Jira: who am I",
  description: "Get the Atlassian site and the Jira account that the tools use.",
  readOnly: true,
  parameters: Type.Object({}),
  output: Type.Object({
    site: Type.String(),
    accountId: Type.String(),
    displayName: Type.String(),
    email: Nullable(Type.String()),
    timeZone: Nullable(Type.String()),
  }),
  run: () =>
    Effect.map(Effect.all([myself, site]), ([me, url]) => ({
      site: url,
      accountId: me.accountId,
      displayName: me.displayName,
      email: me.emailAddress ?? null,
      timeZone: me.timeZone ?? null,
    })),
});

const rawRequest = jiraTool({
  name: "jira_request",
  label: "Jira: REST request",
  description:
    "Send a request to the Jira or Confluence REST API of the site, with the credentials of the user. Use it only when no other jira tool does the job. Resolves to { body }: the JSON body, the text body, or null.",
  readOnly: false,
  parameters: Type.Object({
    path: Type.String({
      description:
        "Path relative to the site, for example /rest/api/3/issue/ABC-1 or /wiki/api/v2/pages/123",
    }),
    method: Type.Optional(
      Type.Union([
        Type.Literal("GET"),
        Type.Literal("POST"),
        Type.Literal("PUT"),
        Type.Literal("DELETE"),
      ]),
    ),
    query: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())]),
        { description: "Query parameters. An array repeats the parameter." },
      ),
    ),
    body: Type.Optional(Type.Unknown({ description: "JSON request body" })),
  }),
  output: Type.Object({ body: Type.Unknown() }),
  run: (params) => Effect.map(request(params), (body) => ({ body })),
});

const fields = jiraTool({
  name: "jira_fields",
  label: "Jira: fields",
  description:
    "List the fields of the site, with their IDs. Field IDs (for example customfield_12345) are different on each site, so find them by name.",
  readOnly: true,
  parameters: Type.Object({
    name: Type.Optional(Type.String({ description: "Only fields whose name contains this text" })),
  }),
  output: Type.Object({
    fields: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String(), custom: Type.Boolean() }),
    ),
  }),
  run: (params) => Effect.map(listFields(params.name), (list) => ({ fields: list })),
});

const search = jiraTool({
  name: "jira_search",
  label: "Jira: search",
  description:
    "Find issues with JQL, across all projects. Accounted and Removed issues are left out unless includeHidden is true.",
  readOnly: true,
  parameters: Type.Object({
    jql: Type.String({
      description: "JQL, for example assignee = currentUser() AND statusCategory != Done",
    }),
    fields: Type.Optional(
      Type.Array(Type.String(), {
        description: "Other field IDs to give as raw values in `fields` of each issue",
      }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum issues. Default: 50" })),
    includeHidden: Type.Optional(
      Type.Boolean({ description: "Also give Accounted and Removed issues" }),
    ),
  }),
  output: Type.Object({
    issues: Type.Array(
      Type.Object({
        ...IssueSummaryProperties,
        fields: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
    ),
    hiddenCount: Type.Integer({ description: "Accounted and Removed issues left out" }),
  }),
  run: searchIssues,
});

const issue = jiraTool({
  name: "jira_issue",
  label: "Jira: read issue",
  description:
    "Read one issue: the description and the Acceptance Criteria as Markdown, sub-tasks, time tracking, and the last comments. Always read both the description and the Acceptance Criteria.",
  readOnly: true,
  parameters: Type.Object({
    key: Key,
    comments: Type.Optional(
      Type.Integer({ minimum: 0, description: "Number of last comments. Default: 5" }),
    ),
  }),
  output: Type.Object({
    ...IssueSummaryProperties,
    reporter: Nullable(Type.String()),
    created: Nullable(Type.String()),
    labels: Type.Array(Type.String()),
    timetracking: Type.Object({
      originalEstimate: Nullable(Type.String()),
      remainingEstimate: Nullable(Type.String()),
      timeSpent: Nullable(Type.String()),
    }),
    subtasks: Type.Array(
      Type.Object({ key: Type.String(), summary: Type.String(), status: Nullable(Type.String()) }),
    ),
    description: Type.String(),
    acceptanceCriteria: Nullable(
      Type.String({ description: "Null when the site has no Acceptance Criteria field" }),
    ),
    comments: Type.Array(
      Type.Object({ author: Nullable(Type.String()), created: Type.String(), body: Type.String() }),
    ),
  }),
  run: (params) => readIssue(params.key, params.comments),
});

const createIssueTool = jiraTool({
  name: "jira_create_issue",
  label: "Jira: create issue",
  description:
    "Create an issue. The parent can be an epic in any project. The original estimate is 10h unless you give one. withSubtask also creates a Sub-task with the same summary, for time tracking on a Story or a Bug.",
  readOnly: false,
  parameters: Type.Object({
    project: Type.String({ description: "The project key" }),
    type: Type.String({ description: "The issue type name, for example Task, Story, Sub-task" }),
    summary: Type.String(),
    ...ChangeProperties,
    assignee: Type.Optional(Type.String({ description: '"me" or an account ID' })),
    withSubtask: Type.Optional(Type.Boolean()),
  }),
  output: Type.Object({ key: Type.String(), url: Type.String(), subtask: Nullable(IssueRef) }),
  run: createIssue,
});

const updateIssueTool = jiraTool({
  name: "jira_update_issue",
  label: "Jira: update issue",
  description: "Change the fields of an issue. Fields that you do not give do not change.",
  readOnly: false,
  parameters: Type.Object({
    key: Key,
    summary: Type.Optional(Type.String()),
    ...ChangeProperties,
    assignee: Type.Optional(
      Nullable(Type.String({ description: '"me", an account ID, or null for no assignee' })),
    ),
  }),
  output: IssueRef,
  run: ({ key, ...changes }) => updateIssue(key, changes),
});

const transition = jiraTool({
  name: "jira_transition",
  label: "Jira: move issue",
  description:
    "Move an issue to a status, by the status name or the transition name. If the move is not possible, the error lists the available statuses. Moves to Accounted are refused.",
  readOnly: false,
  parameters: Type.Object({
    key: Key,
    status: Type.String({ description: "For example In Progress" }),
  }),
  output: Type.Object({ key: Type.String(), url: Type.String(), status: Type.String() }),
  run: (params) => transitionIssue(params.key, params.status),
});

const comment = jiraTool({
  name: "jira_comment",
  label: "Jira: comment",
  description: "Add a plain-text comment to an issue. Blank lines separate paragraphs.",
  readOnly: false,
  parameters: Type.Object({ key: Key, text: Type.String() }),
  output: Type.Object({ key: Type.String(), url: Type.String(), commentId: Type.String() }),
  run: (params) => addComment(params.key, params.text),
});

const logWorkTool = jiraTool({
  name: "jira_log_work",
  label: "Jira: log work",
  description:
    "Log time on an issue. Times without an offset use the time zone of the Jira account. Log time on a Sub-task or an ops task, not on a Story.",
  readOnly: false,
  parameters: Type.Object({
    key: Key,
    duration: Duration("Time spent in Jira duration format, for example 1h 30m"),
    started: Type.Optional(
      Type.String({
        description:
          "YYYY-MM-DD (09:00 on that day), YYYY-MM-DDTHH:mm in the account time zone, or an ISO time with an offset. Default: now",
      }),
    ),
    comment: Type.Optional(Type.String()),
  }),
  output: Type.Object({
    key: Type.String(),
    url: Type.String(),
    worklogId: Type.String(),
    seconds: Type.Integer(),
    started: Type.String(),
  }),
  run: logWork,
});

const worklogDay = jiraTool({
  name: "jira_worklog_day",
  label: "Jira: time on a day",
  description:
    "List the issues that the user logged time to on one day, with the time on each. The day uses the time zone of the Jira account. Accounted and Removed issues are counted in `hidden`, not listed.",
  readOnly: true,
  parameters: Type.Object({
    date: Type.Optional(Type.String({ description: "YYYY-MM-DD. Default: today" })),
  }),
  output: Type.Object({
    date: Type.String(),
    timeZone: Type.String(),
    totalSeconds: Type.Integer(),
    total: Type.String({ description: "For example 6h 30m" }),
    issues: Type.Array(
      Type.Object({ ...IssueSummaryProperties, seconds: Type.Integer(), time: Type.String() }),
    ),
    hidden: Type.Object({ count: Type.Integer(), seconds: Type.Integer() }),
    unresolved: Type.Array(Type.String(), {
      description:
        "Issues that JQL finds for the day with no matching worklog. The total can be too low.",
    }),
  }),
  run: (params) => workDay(params.date),
});

/** The tools for issues, fields, time tracking, and raw REST requests. */
export const ISSUE_TOOLS = [
  whoami,
  rawRequest,
  fields,
  search,
  issue,
  createIssueTool,
  updateIssueTool,
  transition,
  comment,
  logWorkTool,
  worklogDay,
];
