import { z } from "zod";

import {
  githubRepoThread,
  githubThread,
  runCommand,
  type CommandRunner,
  type FactoryEvent,
} from "../core/index.ts";
import { oneLine, pollStart, type Cursor, type PollResult, type Source } from "./source.ts";

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

/**
 * Returns the event of a notification. `summary` is the text of the last comment, when the daemon
 * got it. The id has the update time, so that a new update on the same thread is a new event.
 */
export function githubEvent(n: Notification, summary?: string): FactoryEvent {
  return {
    id: `gh-${n.id}-${n.updated_at.replace(/[^\dTZ]/g, "")}`,
    source: "github",
    thread: notificationThread(n),
    kind: githubKind(n),
    title: n.subject.title,
    summary: summary ?? `${n.reason.replace(/_/g, " ")}: ${n.subject.title}`,
    url: notificationUrl(n),
    ts: n.updated_at,
  };
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

function notificationArgs(cursor: Cursor, now: Date): string[] {
  const since = pollStart(cursor.since, now);
  const args = ["api", "-i", "notifications", "-X", "GET", "-f", "all=true", "-f", "per_page=50"];
  args.push("-f", `since=${since}`);
  if (cursor.lastModified) args.push("-H", `If-Modified-Since: ${cursor.lastModified}`);
  return args;
}

async function commentSummary(runner: CommandRunner, url: string): Promise<string | undefined> {
  const result = await runner("gh", ["api", url], 15_000).catch(() => undefined);
  if (result?.code !== 0) return undefined;
  const parsed = commentSchema.safeParse(JSON.parse(result.stdout));
  return parsed.success
    ? oneLine(`@${parsed.data.user.login}: ${parsed.data.body ?? ""}`)
    : undefined;
}

async function toEvents(
  runner: CommandRunner,
  notifications: Notification[],
): Promise<FactoryEvent[]> {
  return Promise.all(
    notifications.map(async (n, index) => {
      const url = index < MAX_COMMENT_FETCHES ? commentUrl(n) : undefined;
      return githubEvent(n, url ? await commentSummary(runner, url) : undefined);
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
      const events = await toEvents(runner, parseNotifications(response, result.stderr));
      const interval = Number(response.headers["x-poll-interval"]);
      const poll: PollResult = { events, cursor: nextGithubCursor(cursor, response, events) };
      return Number.isFinite(interval) ? { ...poll, minIntervalSeconds: interval } : poll;
    },
  };
}
