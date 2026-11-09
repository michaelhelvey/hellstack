import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
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
import { jiraTool, READS, WRITES } from "./define.ts";

const text = (description: string) => Schema.String.annotate({ description });

const NullableString = Schema.NullOr(Schema.String);

const IssueSummaryFields = {
  key: Schema.String,
  url: Schema.String,
  summary: NullableString,
  type: NullableString,
  status: NullableString,
  statusCategory: Schema.NullOr(text("new (To Do), indeterminate (In Progress), or done")),
  assignee: NullableString,
  priority: NullableString,
  parent: Schema.NullOr(text("The key of the parent issue")),
  project: NullableString,
  updated: NullableString,
};

/** The short view of an issue. */
export const IssueSummary = Schema.Struct(IssueSummaryFields);

const IssueRef = Schema.Struct({ key: Schema.String, url: Schema.String });

const Key = text("The issue key, for example ABC-123");

const FieldValues = Schema.Record(Schema.String, Schema.Unknown).annotate({
  description:
    'Other fields, by field ID or field name. Values use the REST API format, for example { "Story Points": 3 }. Fields that project managers set (Business Category, Operations Category, Complete Work Sprint, CWIP) are refused.',
});

const ChangeFields = {
  description: Schema.optionalKey(text("Plain text. Blank lines separate paragraphs.")),
  parent: Schema.optionalKey(text("The key of the parent issue, for example an epic")),
  estimate: Schema.optionalKey(text("Original estimate in Jira duration format, for example 10h")),
  fields: Schema.optionalKey(FieldValues),
};

const Whoami = jiraTool("whoami", {
  description: "Get the Atlassian site and the Jira account that the tools use.",
  hints: READS,
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    site: Schema.String,
    accountId: Schema.String,
    displayName: Schema.String,
    email: NullableString,
    timeZone: NullableString,
  }),
});

const Request = jiraTool("request", {
  description:
    "Send a request to the Jira or Confluence REST API of the site, with the credentials of the user. Use it only when no other tool does the job. Gives { body }: the JSON body, the text body, or null.",
  hints: WRITES,
  parameters: Schema.Struct({
    path: text(
      "Path relative to the site, for example /rest/api/3/issue/ABC-1 or /wiki/api/v2/pages/123",
    ),
    method: Schema.optionalKey(Schema.Literals(["GET", "POST", "PUT", "DELETE"])),
    query: Schema.optionalKey(
      Schema.Record(
        Schema.String,
        Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Array(Schema.String)]),
      ).annotate({ description: "Query parameters. An array repeats the parameter." }),
    ),
    body: Schema.optionalKey(Schema.Unknown.annotate({ description: "JSON request body" })),
  }),
  success: Schema.Struct({ body: Schema.Unknown }),
});

const Fields = jiraTool("fields", {
  description:
    "List the fields of the site, with their IDs. Field IDs (for example customfield_12345) are different on each site, so find them by name.",
  hints: READS,
  parameters: Schema.Struct({
    name: Schema.optionalKey(text("Only fields whose name contains this text")),
  }),
  success: Schema.Struct({
    fields: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String, custom: Schema.Boolean }),
    ),
  }),
});

const Search = jiraTool("search", {
  description:
    "Find issues with JQL, across all projects. Accounted and Removed issues are left out unless includeHidden is true.",
  hints: READS,
  parameters: Schema.Struct({
    jql: text("JQL, for example assignee = currentUser() AND statusCategory != Done"),
    fields: Schema.optionalKey(
      Schema.Array(Schema.String).annotate({
        description: "Other field IDs to give as raw values in `fields` of each issue",
      }),
    ),
    limit: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
        description: "Maximum issues. Default: 50",
      }),
    ),
    includeHidden: Schema.optionalKey(
      Schema.Boolean.annotate({ description: "Also give Accounted and Removed issues" }),
    ),
  }),
  success: Schema.Struct({
    issues: Schema.Array(
      Schema.Struct({
        ...IssueSummaryFields,
        fields: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    ),
    hiddenCount: Schema.Int.annotate({ description: "Accounted and Removed issues left out" }),
  }),
});

const Issue = jiraTool("issue", {
  description:
    "Read one issue: the description and the Acceptance Criteria as Markdown, sub-tasks, time tracking, and the last comments. Always read both the description and the Acceptance Criteria.",
  hints: READS,
  parameters: Schema.Struct({
    key: Key,
    comments: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
        description: "Number of last comments. Default: 5",
      }),
    ),
  }),
  success: Schema.Struct({
    ...IssueSummaryFields,
    reporter: NullableString,
    created: NullableString,
    labels: Schema.Array(Schema.String),
    timetracking: Schema.Struct({
      originalEstimate: NullableString,
      remainingEstimate: NullableString,
      timeSpent: NullableString,
    }),
    subtasks: Schema.Array(
      Schema.Struct({ key: Schema.String, summary: Schema.String, status: NullableString }),
    ),
    description: Schema.String,
    acceptanceCriteria: Schema.NullOr(text("Null when the site has no Acceptance Criteria field")),
    comments: Schema.Array(
      Schema.Struct({ author: NullableString, created: Schema.String, body: Schema.String }),
    ),
  }),
});

const CreateIssue = jiraTool("create_issue", {
  description:
    "Create an issue. The parent can be an epic in any project. The original estimate is 10h unless you give one. withSubtask also creates a Sub-task with the same summary, for time tracking on a Story or a Bug.",
  hints: WRITES,
  parameters: Schema.Struct({
    project: text("The project key"),
    type: text("The issue type name, for example Task, Story, Sub-task"),
    summary: Schema.String,
    ...ChangeFields,
    assignee: Schema.optionalKey(text('"me" or an account ID')),
    withSubtask: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    key: Schema.String,
    url: Schema.String,
    subtask: Schema.NullOr(IssueRef),
  }),
});

const UpdateIssue = jiraTool("update_issue", {
  description: "Change the fields of an issue. Fields that you do not give do not change.",
  hints: WRITES,
  parameters: Schema.Struct({
    key: Key,
    summary: Schema.optionalKey(Schema.String),
    ...ChangeFields,
    assignee: Schema.optionalKey(
      Schema.NullOr(text('"me", an account ID, or null for no assignee')),
    ),
  }),
  success: IssueRef,
});

const Transition = jiraTool("transition", {
  description:
    "Move an issue to a status, by the status name or the transition name. If the move is not possible, the error lists the available statuses. Moves to Accounted are refused.",
  hints: WRITES,
  parameters: Schema.Struct({ key: Key, status: text("For example In Progress") }),
  success: Schema.Struct({ key: Schema.String, url: Schema.String, status: Schema.String }),
});

const Comment = jiraTool("comment", {
  description: "Add a plain-text comment to an issue. Blank lines separate paragraphs.",
  hints: WRITES,
  parameters: Schema.Struct({ key: Key, text: Schema.String }),
  success: Schema.Struct({ key: Schema.String, url: Schema.String, commentId: Schema.String }),
});

const LogWork = jiraTool("log_work", {
  description:
    "Log time on an issue. Times without an offset use the time zone of the Jira account. Log time on a Sub-task or an ops task, not on a Story.",
  hints: WRITES,
  parameters: Schema.Struct({
    key: Key,
    duration: text("Time spent in Jira duration format, for example 1h 30m"),
    started: Schema.optionalKey(
      text(
        "YYYY-MM-DD (09:00 on that day), YYYY-MM-DDTHH:mm in the account time zone, or an ISO time with an offset. Default: now",
      ),
    ),
    comment: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({
    key: Schema.String,
    url: Schema.String,
    worklogId: Schema.String,
    seconds: Schema.Int,
    started: Schema.String,
  }),
});

const WorklogDay = jiraTool("worklog_day", {
  description:
    "List the issues that the user logged time to on one day, with the time on each. The day uses the time zone of the Jira account. Accounted and Removed issues are counted in `hidden`, not listed.",
  hints: READS,
  parameters: Schema.Struct({ date: Schema.optionalKey(text("YYYY-MM-DD. Default: today")) }),
  success: Schema.Struct({
    date: Schema.String,
    timeZone: Schema.String,
    totalSeconds: Schema.Int,
    total: text("For example 6h 30m"),
    issues: Schema.Array(
      Schema.Struct({ ...IssueSummaryFields, seconds: Schema.Int, time: Schema.String }),
    ),
    hidden: Schema.Struct({ count: Schema.Int, seconds: Schema.Int }),
    unresolved: Schema.Array(Schema.String).annotate({
      description:
        "Issues that JQL finds for the day with no matching worklog. The total can be too low.",
    }),
  }),
});

/** The tools for issues, fields, time tracking, and raw REST requests. */
export const IssueTools = Toolkit.make(
  Whoami,
  Request,
  Fields,
  Search,
  Issue,
  CreateIssue,
  UpdateIssue,
  Transition,
  Comment,
  LogWork,
  WorklogDay,
);

/** The handlers of {@link IssueTools}. */
export const IssueHandlers = IssueTools.toLayer({
  whoami: () =>
    Effect.map(Effect.all([myself, site]), ([me, url]) => ({
      site: url,
      accountId: me.accountId,
      displayName: me.displayName,
      email: me.emailAddress ?? null,
      timeZone: me.timeZone ?? null,
    })),
  request: (params) => Effect.map(request(params), (body) => ({ body })),
  fields: (params) => Effect.map(listFields(params.name), (list) => ({ fields: list })),
  search: searchIssues,
  issue: (params) => readIssue(params.key, params.comments),
  create_issue: createIssue,
  update_issue: ({ key, ...changes }) => updateIssue(key, changes),
  transition: (params) => transitionIssue(params.key, params.status),
  comment: (params) => addComment(params.key, params.text),
  log_work: logWork,
  worklog_day: (params) => workDay(params.date),
});
