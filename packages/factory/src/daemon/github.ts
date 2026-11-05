import { z } from "zod";

import {
  githubRepoThread,
  githubThread,
  runCommand,
  type CommandRunner,
  type FactoryEvent,
} from "../core/index.ts";
import {
  excerpt,
  oneLine,
  pollStart,
  type Cursor,
  type PollResult,
  type Source,
} from "./source.ts";

/** A notification of `gh api notifications`. */
export const notificationSchema = z.object({
  id: z.string(),
  reason: z.string(),
  updated_at: z.iso.datetime(),
  subject: z.object({
    title: z.string(),
    url: z.string().nullable(),
    latest_comment_url: z.string().nullable(),
    type: z.string(),
  }),
  repository: z.object({ full_name: z.string(), html_url: z.string() }),
});

/** A notification of `gh api notifications`. */
export type Notification = z.infer<typeof notificationSchema>;

const commentSchema = z.object({
  body: z.string().nullish(),
  user: z.object({ login: z.string() }),
});

/** A comment, a review comment, an issue, or a pull request: its author and its text. */
export type GithubComment = z.infer<typeof commentSchema>;

/** An HTTP response that `gh api -i` prints. */
export interface GhResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const reasonKinds: Record<string, string> = {
  review_requested: "review_requested",
  mention: "mention",
  team_mention: "mention",
  security_alert: "security_alert",
  ci_activity: "ci",
  assign: "assigned",
  state_change: "state_change",
};

const typeKinds: Record<string, string> = {
  CheckSuite: "ci",
  WorkflowRun: "ci",
  RepositoryVulnerabilityAlert: "security_alert",
  RepositoryDependabotAlertsThread: "security_alert",
  Release: "release",
  Discussion: "discussion",
  Commit: "commit_comment",
};

const SUBJECT = /\/repos\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/(?<path>pulls|issues)\/(?<number>\d+)$/;

const subjectSchema = z
  .object({ owner: z.string(), repo: z.string(), path: z.string(), number: z.coerce.number() })
  .optional();

function subjectParts(n: Notification): z.infer<typeof subjectSchema> {
  return subjectSchema.parse(SUBJECT.exec(n.subject.url ?? "")?.groups);
}

function statusCode(line: string): number {
  return Number(/^HTTP\/\S+ (\d{3})/.exec(line)?.[1]);
}

function parseHeaders(lines: string[]): Record<string, string> {
  return Object.fromEntries(
    lines.map((line) => {
      const index = line.indexOf(":");
      return [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
    }),
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The count of notifications on one page. */
export const PAGE_SIZE = 50;

/** The maximum count of pages that one poll reads. */
export const MAX_PAGES = 5;

/** The maximum count of comments that one poll gets for the event summaries. */
export const MAX_COMMENT_FETCHES = 10;

/** Parses the output of `gh api -i`: the status line, the headers, an empty line, and the body. */
export function parseGhResponse(text: string): GhResponse {
  const split = text.search(/\r?\n\r?\n/);
  const head = split < 0 ? text : text.slice(0, split);
  const [statusLine, ...lines] = head.split(/\r?\n/);
  const body = split < 0 ? "" : text.slice(split).trimStart();
  return { status: statusCode(statusLine ?? ""), headers: parseHeaders(lines), body };
}

function commentKind(prefix: string, url: string): string {
  if (url.includes("/pulls/comments/")) return "review";
  return url.includes("/comments/") ? `${prefix}_comment` : `${prefix}_update`;
}

function subjectKind(n: Notification): string {
  const prefix = n.subject.type === "PullRequest" ? "pr" : "issue";
  const url = n.reason === "comment" ? "/comments/" : (n.subject.latest_comment_url ?? "");
  return commentKind(prefix, url);
}

/** Returns the event kind of a notification, from its `reason` and its `subject.type`. */
export function githubKind(n: Notification): string {
  return reasonKinds[n.reason] ?? typeKinds[n.subject.type] ?? subjectKind(n);
}

/** Returns the thread key of a notification. A subject without a number gets the repository thread. */
export function notificationThread(n: Notification): string {
  const subject = subjectParts(n);
  if (subject) return githubThread(subject.owner, subject.repo, subject.number);
  const [owner, repo] = n.repository.full_name.split("/");
  return githubRepoThread(owner ?? "", repo ?? "");
}

/** Returns the web URL of the notification subject, or of the repository. */
export function notificationUrl(n: Notification): string {
  const subject = subjectParts(n);
  if (!subject) return n.repository.html_url;
  const path = subject.path === "pulls" ? "pull" : "issues";
  return `https://github.com/${subject.owner}/${subject.repo}/${path}/${subject.number}`;
}

function commentFields(comment: GithubComment | undefined): Partial<FactoryEvent> {
  if (!comment) return {};
  const body = comment.body ?? "";
  return {
    summary: oneLine(`@${comment.user.login}: ${body}`),
    detail: { author: comment.user.login, body: excerpt(body) },
  };
}

/**
 * Returns the event of a notification. `comment` is the last comment, when the daemon got it: it
 * gives the summary and the detail. The id has the notification thread id and the update time, so
 * that a new update on the same thread is a new event.
 */
export function githubEvent(n: Notification, comment?: GithubComment): FactoryEvent {
  const event: FactoryEvent = {
    id: `gh-${n.id}-${n.updated_at.replace(/[^\dTZ]/g, "")}`,
    source: "github",
    thread: notificationThread(n),
    kind: githubKind(n),
    title: n.subject.title,
    summary: `${n.reason.replace(/_/g, " ")}: ${n.subject.title}`,
    url: notificationUrl(n),
    ts: n.updated_at,
    ...commentFields(comment),
  };
  return { ...event, detail: { ...event.detail, repo: n.repository.full_name } };
}

/** Returns the URL of the last comment of a notification, or undefined when it is not a comment. */
export function commentUrl(n: Notification): string | undefined {
  const url = n.subject.latest_comment_url;
  return url?.includes("/comments/") ? url : undefined;
}

/** Returns the cursor after a poll: the newest update time and the `Last-Modified` header. */
export function nextGithubCursor(
  cursor: Cursor,
  response: GhResponse,
  events: FactoryEvent[],
): Cursor {
  const since = events.reduce(
    (newest, event) => (event.ts > newest ? event.ts : newest),
    cursor.since ?? "",
  );
  const lastModified = response.headers["last-modified"] ?? cursor.lastModified ?? "";
  return { since, lastModified };
}

function queryArgs(cursor: Cursor, now: Date): string[] {
  const since = pollStart(cursor.since, now);
  return [
    "notifications",
    "-X",
    "GET",
    "-f",
    "all=true",
    "-f",
    `per_page=${PAGE_SIZE}`,
    "-f",
    `since=${since}`,
  ];
}

function notificationArgs(cursor: Cursor, now: Date): string[] {
  const args = ["api", "-i", ...queryArgs(cursor, now)];
  if (cursor.lastModified) args.push("-H", `If-Modified-Since: ${cursor.lastModified}`);
  return args;
}

async function readPage(runner: CommandRunner, args: string[]): Promise<Notification[]> {
  const result = await runner("gh", args, 30_000);
  if (result.code !== 0) throw new Error(`gh api notifications failed: ${oneLine(result.stderr)}`);
  return z.array(notificationSchema).parse(JSON.parse(result.stdout));
}

/** Reads the pages after the first page while each page is full, up to {@link MAX_PAGES}. */
async function laterPages(
  runner: CommandRunner,
  first: Notification[],
  cursor: Cursor,
  now: Date,
): Promise<Notification[]> {
  const all = [...first];
  for (let page = 2; page <= MAX_PAGES && all.length === (page - 1) * PAGE_SIZE; page++) {
    all.push(...(await readPage(runner, ["api", ...queryArgs(cursor, now), "-f", `page=${page}`])));
  }
  return all;
}

/**
 * Reads the notifications that changed after `since`, read ones too, up to {@link MAX_PAGES} pages.
 * The list does not have the notifications that the user marked done.
 */
export async function listNotifications(
  runner: CommandRunner,
  since: string,
  now: Date,
): Promise<Notification[]> {
  const first = await readPage(runner, ["api", ...queryArgs({ since }, now)]);
  return laterPages(runner, first, { since }, now);
}

async function fetchComment(
  runner: CommandRunner,
  url: string,
): Promise<GithubComment | undefined> {
  const result = await runner("gh", ["api", url], 15_000).catch(() => undefined);
  if (result?.code !== 0) return undefined;
  return commentSchema.safeParse(parseJson(result.stdout)).data;
}

async function toEvents(
  runner: CommandRunner,
  notifications: Notification[],
): Promise<FactoryEvent[]> {
  return Promise.all(
    notifications.map(async (n, index) => {
      const url = index < MAX_COMMENT_FETCHES ? commentUrl(n) : undefined;
      return githubEvent(n, url ? await fetchComment(runner, url) : undefined);
    }),
  );
}

function parseNotifications(response: GhResponse, stderr: string): Notification[] {
  if (response.status === 304) return [];
  if (response.status !== 200) throw new Error(`gh api notifications failed: ${oneLine(stderr)}`);
  return z.array(notificationSchema).parse(JSON.parse(response.body));
}

/** Returns the GitHub source. It reads `gh api notifications` with the `gh auth` credentials. */
export function createGithubSource(runner: CommandRunner = runCommand): Source {
  return {
    async poll(cursor = {}, now) {
      const result = await runner("gh", notificationArgs(cursor, now), 30_000);
      const response = parseGhResponse(result.stdout);
      const first = parseNotifications(response, result.stderr);
      const events = await toEvents(runner, await laterPages(runner, first, cursor, now));
      const interval = Number(response.headers["x-poll-interval"]);
      const poll: PollResult = { events, cursor: nextGithubCursor(cursor, response, events) };
      return Number.isFinite(interval) ? { ...poll, minIntervalSeconds: interval } : poll;
    },
  };
}
