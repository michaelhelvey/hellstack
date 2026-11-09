import { Effect, Schema } from "effect";
import { Atlassian, AtlassianError, get } from "../atlassian.ts";
import { Issue, SearchPage } from "./schemas.ts";

/**
 * The statuses that the tools do not show by default. "Accounted" issues are frozen for an
 * internal audit, and "Removed" issues are work that the team will not do.
 */
export const HIDDEN_STATUSES: ReadonlyArray<string> = ["Accounted", "Removed"];

/** True when the status name is one of the {@link HIDDEN_STATUSES}. */
export const isHiddenStatus = (name: string | undefined) =>
  HIDDEN_STATUSES.some((hidden) => hidden.toLowerCase() === name?.toLowerCase());

/** The fields that a search gets when the caller does not ask for other fields. */
export const SUMMARY_FIELDS: ReadonlyArray<string> = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "parent",
  "project",
  "updated",
];

const PAGE_SIZE = 100;

type RawIssue = (typeof SearchPage.Type)["issues"][number];

const page = (jql: string, fields: ReadonlyArray<string>, size: number, token: string | null) =>
  get(SearchPage, "/rest/api/3/search/jql", {
    jql,
    fields: fields.join(","),
    maxResults: size,
    ...(token === null ? {} : { nextPageToken: token }),
  });

const pages = (
  jql: string,
  fields: ReadonlyArray<string>,
  limit: number,
  token: string | null = null,
): Effect.Effect<ReadonlyArray<RawIssue>, AtlassianError, Atlassian> =>
  Effect.flatMap(page(jql, fields, Math.min(PAGE_SIZE, limit), token), (result) => {
    const next = result.nextPageToken ?? null;
    const rest = limit - result.issues.length;
    return next === null || rest <= 0
      ? Effect.succeed(result.issues)
      : Effect.map(pages(jql, fields, rest, next), (more) => [...result.issues, ...more]);
  });

/**
 * Finds the issues that match the JQL, with all pages, up to `limit` issues. Each issue has only
 * the given fields, as raw JSON values.
 */
export const searchRaw = (jql: string, fields: ReadonlyArray<string>, limit = Infinity) =>
  pages(jql, fields, limit);

const decodeIssue = Schema.decodeUnknownEffect(Issue);

/** Decodes the fields of a raw issue that this package reads. */
export const toIssue = (raw: RawIssue) =>
  decodeIssue(raw).pipe(
    Effect.mapError(
      (error) => new AtlassianError({ message: `unexpected issue ${raw.key}: ${error.message}` }),
    ),
  );

/** Finds all issues that match the JQL. Each issue has only the given fields. */
export const search = (jql: string, fields: ReadonlyArray<string>, limit = Infinity) =>
  Effect.flatMap(searchRaw(jql, fields, limit), Effect.forEach(toIssue));

/** A short view of an issue, for lists. Values that the issue does not have are null. */
export interface IssueSummary {
  readonly key: string;
  readonly url: string;
  readonly summary: string | null;
  readonly type: string | null;
  readonly status: string | null;
  /** The status category: `new` (To Do), `indeterminate` (In Progress), or `done`. */
  readonly statusCategory: string | null;
  readonly assignee: string | null;
  readonly priority: string | null;
  readonly parent: string | null;
  readonly project: string | null;
  readonly updated: string | null;
}

/** Gives null for a value that is null or undefined. */
export const orNull = <A>(value: A | null | undefined): A | null => value ?? null;

/** The name of an object that can be missing, or null. */
export const nameOf = (value: { readonly name: string } | null | undefined) => orNull(value?.name);

/** The key of an object that can be missing, or null. */
export const keyOf = (value: { readonly key: string } | null | undefined) => orNull(value?.key);

/** The display name of a user that can be missing, or null. */
export const displayNameOf = (value: { readonly displayName: string } | null | undefined) =>
  orNull(value?.displayName);

/** The URL of an issue on the site. */
export const issueUrl = (site: string, key: string) => `${site}/browse/${key}`;

/** Makes the short view of an issue. */
export const summarize = (site: string, { key, fields }: Issue): IssueSummary => ({
  key,
  url: issueUrl(site, key),
  summary: orNull(fields.summary),
  type: nameOf(fields.issuetype),
  status: nameOf(fields.status),
  statusCategory: keyOf(orNull(fields.status)?.statusCategory),
  assignee: displayNameOf(fields.assignee),
  priority: nameOf(fields.priority),
  parent: keyOf(fields.parent),
  project: keyOf(fields.project),
  updated: orNull(fields.updated),
});

/** The site URL. */
export const site = Atlassian.use((atlassian) => atlassian.site);

/** The input of {@link searchIssues}. */
export interface SearchInput {
  readonly jql: string;
  /** Other fields to give in `fields`, by field ID. They are raw REST API values. */
  readonly fields?: ReadonlyArray<string> | undefined;
  readonly limit?: number | undefined;
  /** Also give Accounted and Removed issues. */
  readonly includeHidden?: boolean | undefined;
}

/** An issue that {@link searchIssues} found. */
export interface FoundIssue extends IssueSummary {
  /** The values of the fields that the search asked for, if it asked for other fields. */
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** The result of {@link searchIssues}. */
export interface SearchResult {
  readonly issues: ReadonlyArray<FoundIssue>;
  /** The number of Accounted and Removed issues that the result does not include. */
  readonly hiddenCount: number;
}

const pick = (fields: Readonly<Record<string, unknown>>, names: ReadonlyArray<string>) =>
  Object.fromEntries(names.map((name) => [name, fields[name] ?? null]));

const found = (url: string, extra: ReadonlyArray<string>) => (raw: RawIssue) =>
  Effect.map(toIssue(raw), (issue): FoundIssue => {
    const summary = summarize(url, issue);
    return extra.length === 0 ? summary : { ...summary, fields: pick(raw.fields, extra) };
  });

/**
 * Finds issues with JQL, across all projects. Accounted and Removed issues are not included
 * unless `includeHidden` is true.
 */
export const searchIssues = Effect.fnUntraced(function* (input: SearchInput) {
  const extra = input.fields ?? [];
  const raw = yield* searchRaw(input.jql, [...SUMMARY_FIELDS, ...extra], input.limit ?? 50);
  const issues = yield* Effect.forEach(raw, found(yield* site, extra));
  const visible = issues.filter(
    (issue) => input.includeHidden === true || !isHiddenStatus(issue.status ?? undefined),
  );
  const result: SearchResult = { issues: visible, hiddenCount: issues.length - visible.length };
  return result;
});
