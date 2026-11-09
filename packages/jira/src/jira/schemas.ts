import { Effect, Schema } from "effect";

/** A value that can be null. A missing key decodes to null. */
export const nullable = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(schema).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

/** An array. A missing key decodes to an empty array. */
export const list = <S extends Schema.Top>(schema: S) =>
  Schema.Array(schema).pipe(Schema.withDecodingDefault(Effect.succeed([])));

/** A status of an issue, with its category (`new`, `indeterminate`, or `done`). */
export const Status = Schema.Struct({
  name: Schema.String,
  statusCategory: Schema.Struct({ key: Schema.String }),
});

/** An issue type. A lower `hierarchyLevel` is lower in the tree: Sub-task is -1, Epic is 1. */
export const IssueType = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  subtask: Schema.Boolean,
  hierarchyLevel: Schema.Int,
});

/** The type of an {@link IssueType}. */
export type IssueType = typeof IssueType.Type;

/** A Jira user. */
export const User = Schema.Struct({
  accountId: Schema.optional(Schema.String),
  displayName: Schema.String,
});

const Named = Schema.Struct({ name: Schema.String });

/**
 * The fields of an issue that this package reads. A search gives only the fields that it asks for,
 * so all fields are optional.
 */
export const IssueFields = Schema.Struct({
  summary: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  issuetype: Schema.optional(IssueType),
  project: Schema.optional(Schema.Struct({ key: Schema.String })),
  duedate: Schema.optional(Schema.NullOr(Schema.String)),
  assignee: Schema.optional(Schema.NullOr(User)),
  priority: Schema.optional(Schema.NullOr(Named)),
  parent: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        key: Schema.String,
        fields: Schema.optional(Schema.Struct({ summary: Schema.optional(Schema.String) })),
      }),
    ),
  ),
  description: Schema.optional(Schema.Unknown),
  created: Schema.optional(Schema.String),
  updated: Schema.optional(Schema.String),
});

/** An issue with the fields in {@link IssueFields}. */
export const Issue = Schema.Struct({
  key: Schema.String,
  fields: IssueFields,
});

/** The type of an {@link Issue}. */
export type Issue = typeof Issue.Type;

/** An issue with all of its fields as raw JSON values. */
export const RawIssue = Schema.Struct({
  key: Schema.String,
  fields: Schema.Record(Schema.String, Schema.Unknown),
});

/** One page of results from `/rest/api/3/search/jql`. */
export const SearchPage = Schema.Struct({
  issues: Schema.Array(RawIssue),
  nextPageToken: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The user that sends the requests, from `/rest/api/3/myself`. */
export const Myself = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  emailAddress: Schema.optional(Schema.String),
  timeZone: Schema.optional(Schema.String),
});

/** The type of {@link Myself}. */
export type Myself = typeof Myself.Type;
