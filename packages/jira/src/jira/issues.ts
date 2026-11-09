import { Effect, Schema } from "effect";
import { adfToText, textToAdf } from "../adf.ts";
import { AtlassianError, call, get } from "../atlassian.ts";
import { IssueFields, IssueType, list, Myself, nullable, Status, User } from "./schemas.ts";
import {
  displayNameOf,
  issueUrl,
  isHiddenStatus,
  nameOf,
  orNull,
  site,
  summarize,
  type IssueSummary,
} from "./search.ts";

const fail = (message: string) => Effect.fail(new AtlassianError({ message }));

/** Gets the user that sends the requests. */
export const myself = get(Myself, "/rest/api/3/myself");

/** A field of the site, from `/rest/api/3/field`. */
export interface FieldInfo {
  readonly id: string;
  readonly name: string;
  readonly custom: boolean;
}

const Fields = Schema.Array(
  Schema.Struct({ id: Schema.String, name: Schema.String, custom: Schema.Boolean }),
);

/** Lists the fields of the site. With `name`, it gives only the fields whose name contains it. */
export const listFields = (name?: string) =>
  Effect.map(get(Fields, "/rest/api/3/field"), (fields): ReadonlyArray<FieldInfo> =>
    fields.filter((field) => field.name.toLowerCase().includes(name?.toLowerCase() ?? "")),
  );

/**
 * Fields that project managers set manually. The tools refuse to set them. Each pattern matches a
 * field name.
 */
export const PROTECTED_FIELDS: ReadonlyArray<RegExp> = [
  /^business category$/i,
  /^operations category$/i,
  /^complete work sprint$/i,
  /cwip/i,
];

const findField = (fields: ReadonlyArray<FieldInfo>, key: string) => {
  const field = fields.find((f) => f.id === key || f.name.toLowerCase() === key.toLowerCase());
  if (field === undefined) return fail(`no field has the ID or name "${key}"`);
  return PROTECTED_FIELDS.some((pattern) => pattern.test(field.name))
    ? fail(`"${field.name}" is set by project managers. Do not set or change it.`)
    : Effect.succeed(field.id);
};

/**
 * Changes the keys of `extra` from field IDs or field names to field IDs. It fails for a field
 * that does not exist, and for a field in {@link PROTECTED_FIELDS}.
 */
export const resolveFields = (extra: Readonly<Record<string, unknown>> = {}) =>
  Object.keys(extra).length === 0
    ? Effect.succeed({})
    : Effect.flatMap(listFields(), (fields) =>
        Effect.forEach(Object.entries(extra), ([key, value]) =>
          Effect.map(findField(fields, key), (id) => [id, value] as const),
        ).pipe(Effect.map(Object.fromEntries<unknown>)),
      );

const Comment = Schema.Struct({
  author: nullable(User),
  created: Schema.String,
  body: Schema.optional(Schema.Unknown),
});

const TimeTracking = Schema.Struct({
  originalEstimate: nullable(Schema.String),
  remainingEstimate: nullable(Schema.String),
  timeSpent: nullable(Schema.String),
});

const DetailFields = Schema.Struct({
  ...IssueFields.fields,
  reporter: nullable(User),
  labels: list(Schema.String),
  timetracking: TimeTracking.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  subtasks: list(
    Schema.Struct({
      key: Schema.String,
      fields: Schema.Struct({ summary: Schema.String, status: Schema.optional(Status) }),
    }),
  ),
  comment: Schema.Struct({ comments: list(Comment) }).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});

const IssueWithNames = Schema.Struct({
  key: Schema.String,
  fields: Schema.Record(Schema.String, Schema.Unknown),
  names: Schema.Record(Schema.String, Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});

const decodeDetails = Schema.decodeUnknownEffect(DetailFields);

/** All that a person must read to understand an issue. */
export interface IssueDetails extends IssueSummary {
  readonly reporter: string | null;
  readonly created: string | null;
  readonly labels: ReadonlyArray<string>;
  readonly timetracking: {
    readonly originalEstimate: string | null;
    readonly remainingEstimate: string | null;
    readonly timeSpent: string | null;
  };
  readonly subtasks: ReadonlyArray<{
    readonly key: string;
    readonly summary: string;
    readonly status: string | null;
  }>;
  /** The description as Markdown text. */
  readonly description: string;
  /** The "Acceptance Criteria" field as Markdown text, or null if the site has no such field. */
  readonly acceptanceCriteria: string | null;
  /** The last comments, oldest first. */
  readonly comments: ReadonlyArray<{
    readonly author: string | null;
    readonly created: string;
    readonly body: string;
  }>;
}

const acceptanceCriteria = (
  names: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, unknown>>,
) => {
  const id = Object.keys(names).find((key) => names[key]?.toLowerCase() === "acceptance criteria");
  return id === undefined ? null : adfToText(fields[id]);
};

type Details = typeof DetailFields.Type;

const subtasks = (fields: Details) =>
  fields.subtasks.map((task) => ({
    key: task.key,
    summary: task.fields.summary,
    status: nameOf(task.fields.status),
  }));

const comments = (fields: Details, count: number) =>
  count <= 0
    ? []
    : fields.comment.comments.slice(-count).map((c) => ({
        author: displayNameOf(c.author),
        created: c.created,
        body: adfToText(c.body),
      }));

/** Reads one issue, with its description, Acceptance Criteria, sub-tasks, and last comments. */
export const readIssue = Effect.fnUntraced(function* (key: string, commentCount = 5) {
  const raw = yield* get(IssueWithNames, `/rest/api/3/issue/${key}`, { expand: "names" });
  const fields = yield* decodeDetails(raw.fields).pipe(
    Effect.mapError(
      (error) => new AtlassianError({ message: `unexpected issue ${key}: ${error.message}` }),
    ),
  );
  const details: IssueDetails = {
    ...summarize(yield* site, { key: raw.key, fields }),
    reporter: displayNameOf(fields.reporter),
    created: orNull(fields.created),
    labels: fields.labels,
    timetracking: fields.timetracking,
    subtasks: subtasks(fields),
    description: adfToText(fields.description),
    acceptanceCriteria: acceptanceCriteria(raw.names, raw.fields),
    comments: comments(fields, commentCount),
  };
  return details;
});

/** The key and the URL of an issue that a tool created or changed. */
export interface IssueRef {
  readonly key: string;
  readonly url: string;
}

const ref = (key: string) =>
  Effect.map(site, (url): IssueRef => ({ key, url: issueUrl(url, key) }));

const assigneeId = (assignee: string | null) =>
  assignee === "me" ? Effect.map(myself, (me) => me.accountId) : Effect.succeed(assignee);

/** The fields that a create or an edit can set. A value that is undefined does not change. */
export interface IssueChanges {
  readonly summary?: string | undefined;
  /** Plain text. Blank lines separate paragraphs. */
  readonly description?: string | undefined;
  readonly parent?: string | undefined;
  /** An original estimate in Jira duration format, for example `10h`. */
  readonly estimate?: string | undefined;
  /** `me`, an account ID, or null for no assignee. */
  readonly assignee?: string | null | undefined;
  /** Other fields, by field ID or field name. The values use the format of the REST API. */
  readonly fields?: Readonly<Record<string, unknown>> | undefined;
}

const ifSet = <A, B>(value: A | undefined, make: (value: A) => B) =>
  value === undefined ? {} : make(value);

const CHANGES: ReadonlyArray<(changes: IssueChanges) => Record<string, unknown>> = [
  (c) => ifSet(c.summary, (summary) => ({ summary })),
  (c) => ifSet(c.description, (text) => ({ description: textToAdf(text) })),
  (c) => ifSet(c.parent, (key) => ({ parent: { key } })),
  (c) => ifSet(c.estimate, (originalEstimate) => ({ timetracking: { originalEstimate } })),
];

const assigneeField = (assignee: string | null | undefined) =>
  assignee === undefined
    ? Effect.succeed({})
    : Effect.map(assigneeId(assignee), (accountId) => ({ assignee: { accountId } }));

const issueFields = (changes: IssueChanges) =>
  Effect.map(
    Effect.all([resolveFields(changes.fields), assigneeField(changes.assignee)]),
    ([extra, assignee]): Record<string, unknown> =>
      Object.assign({}, extra, ...CHANGES.map((change) => change(changes)), assignee),
  );

/** The input of {@link createIssue}. */
export interface NewIssue extends IssueChanges {
  readonly project: string;
  /** The name of the issue type, for example `Task`, `Story`, or `Sub-task`. */
  readonly type: string;
  readonly summary: string;
  /** Also create a Sub-task with the same summary, estimate, and assignee. */
  readonly withSubtask?: boolean | undefined;
}

/** The default original estimate. Jira does not move an issue to In Progress without one. */
export const DEFAULT_ESTIMATE = "10h";

const Created = Schema.Struct({ key: Schema.String });

const ProjectTypes = Schema.Struct({ issueTypes: Schema.Array(IssueType) });

/** Gets the issue types of a project. */
export const projectIssueTypes = (project: string) =>
  Effect.map(get(ProjectTypes, `/rest/api/3/project/${project}`), (p) => p.issueTypes);

const post = (fields: Record<string, unknown>) =>
  call(Created, { method: "POST", path: "/rest/api/3/issue", body: { fields } });

const createSubtask = Effect.fnUntraced(function* (parent: string, issue: NewIssue) {
  const types = yield* projectIssueTypes(issue.project);
  const type = types.find((t) => t.subtask);
  if (type === undefined) return yield* fail(`project ${issue.project} has no Sub-task type`);
  const fields = yield* issueFields({
    ...issue,
    parent,
    fields: undefined,
    description: undefined,
  });
  const { key } = yield* post({
    ...fields,
    project: { key: issue.project },
    issuetype: { id: type.id },
  });
  return yield* ref(key);
});

/**
 * Creates an issue. It uses the `parent` field, so the parent can be an epic in any project. The
 * original estimate is {@link DEFAULT_ESTIMATE} if the input does not give one.
 */
export const createIssue = Effect.fnUntraced(function* (input: NewIssue) {
  const issue = { ...input, estimate: input.estimate ?? DEFAULT_ESTIMATE };
  const fields = yield* issueFields(issue);
  const { key } = yield* post({
    ...fields,
    project: { key: issue.project },
    issuetype: { name: issue.type },
  });
  const subtask = issue.withSubtask === true ? yield* createSubtask(key, issue) : null;
  return { ...(yield* ref(key)), subtask };
});

/** Changes the fields of an issue. */
export const updateIssue = Effect.fnUntraced(function* (key: string, changes: IssueChanges) {
  const fields = yield* issueFields(changes);
  if (Object.keys(fields).length === 0) return yield* fail("give at least one field to change");
  yield* call(Schema.Unknown, {
    method: "PUT",
    path: `/rest/api/3/issue/${key}`,
    body: { fields },
  });
  return yield* ref(key);
});

const Transitions = Schema.Struct({
  transitions: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, to: Status })),
});

type Transition = (typeof Transitions.Type)["transitions"][number];

/** Gets the transitions that an issue can do now. */
export const transitions = (key: string) =>
  Effect.map(get(Transitions, `/rest/api/3/issue/${key}/transitions`), (t) => t.transitions);

const doTransition = (key: string, transition: Transition) =>
  call(Schema.Unknown, {
    method: "POST",
    path: `/rest/api/3/issue/${key}/transitions`,
    body: { transition: { id: transition.id } },
  });

const matches = (transition: Transition, status: string) =>
  [transition.to.name, transition.name].some((name) => name.toLowerCase() === status.toLowerCase());

/**
 * Moves an issue to a status. `status` is the name of the target status or of the transition. It
 * refuses "Accounted", because only project managers set it.
 */
export const transitionIssue = Effect.fnUntraced(function* (key: string, status: string) {
  if (status.toLowerCase() === "accounted") {
    return yield* fail("only project managers move issues to Accounted");
  }
  const available = yield* transitions(key);
  const transition = available.find((t) => matches(t, status));
  if (transition === undefined) {
    const names = available.map((t) => `${t.to.name} (${t.name})`).join(", ");
    return yield* fail(`${key} cannot move to "${status}". Available: ${names || "none"}`);
  }
  yield* doTransition(key, transition);
  return { ...(yield* ref(key)), status: transition.to.name };
});

/**
 * Moves an issue to the first status in a status category (`new`, `indeterminate`, or `done`).
 * Gives the name of the new status, or null if the workflow has no such transition.
 */
export const transitionToCategory = Effect.fnUntraced(function* (key: string, category: string) {
  const transition = (yield* transitions(key)).find(
    (t) => t.to.statusCategory.key === category && !isHiddenStatus(t.to.name),
  );
  if (transition === undefined) return null;
  yield* doTransition(key, transition);
  return transition.to.name;
});

const CreatedComment = Schema.Struct({ id: Schema.String });

/** Adds a plain-text comment to an issue. Blank lines separate paragraphs. */
export const addComment = Effect.fnUntraced(function* (key: string, text: string) {
  const { id } = yield* call(CreatedComment, {
    method: "POST",
    path: `/rest/api/3/issue/${key}/comment`,
    body: { body: textToAdf(text) },
  });
  return { ...(yield* ref(key)), commentId: id };
});
