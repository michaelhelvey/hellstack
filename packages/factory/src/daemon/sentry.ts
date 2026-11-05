import { z } from "zod";

import {
  runCommand,
  sentryThread,
  type CommandRunner,
  type EventDetail,
  type FactoryEvent,
  type SourceConfig,
} from "../core/index.ts";
import { excerpt, oneLine, pollStart, type InboxSource, type Source } from "./source.ts";

/** An issue of the Sentry issues API. */
export const sentryIssueSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string(),
  culprit: z.string().nullish(),
  permalink: z.string(),
  firstSeen: z.iso.datetime({ offset: true }),
  lastSeen: z.iso.datetime({ offset: true }),
  status: z.string().nullish(),
  substatus: z.string().nullish(),
  count: z.string().nullish(),
  metadata: z.looseObject({ value: z.string().nullish() }).nullish(),
  project: z.object({ slug: z.string() }),
});

/** An issue of the Sentry issues API. */
export type SentryIssue = z.infer<typeof sentryIssueSchema>;

/** The config of the Sentry source. */
export type SentryConfig = Extract<SourceConfig, { type: "sentry" }>;

/** The issue statuses that are done: the inbox does not keep events of these issues. */
export const DONE_STATUSES: readonly string[] = ["resolved", "ignored"];

const issuesSchema = z.array(sentryIssueSchema);
const statusesSchema = z.array(z.object({ id: z.string(), status: z.string().nullish() }));

function issueKind(issue: SentryIssue, since: string): string | undefined {
  if (Date.parse(issue.firstSeen) >= Date.parse(since)) return "issue_new";
  return issue.substatus === "regressed" ? "issue_regression" : undefined;
}

function issueSummary(issue: SentryIssue): string {
  const where = issue.culprit ? ` in ${issue.culprit}` : "";
  return oneLine(`${issue.project.slug}: ${issue.title}${where} (${issue.count ?? "?"} events)`);
}

function issueBody(issue: SentryIssue): string {
  const lines = [issue.metadata?.value, issue.culprit && `in ${issue.culprit}`];
  return excerpt([...lines, `${issue.count ?? "?"} events`].filter(Boolean).join("\n"));
}

function issueDetail(issue: SentryIssue): EventDetail {
  return { body: issueBody(issue), state: issue.status ?? "unresolved", repo: issue.project.slug };
}

/**
 * Returns the event of an issue: `issue_new` when Sentry first saw it after `since`,
 * `issue_regression` when it regressed. Returns undefined for other issues.
 */
export function sentryEvent(
  org: string,
  issue: SentryIssue,
  since: string,
): FactoryEvent | undefined {
  const kind = issueKind(issue, since);
  if (!kind) return undefined;
  return {
    id: `sentry-${issue.id}-${kind === "issue_new" ? "new" : "regression"}`,
    source: "sentry",
    thread: sentryThread(org, issue.shortId),
    kind,
    title: issue.title,
    summary: issueSummary(issue),
    url: issue.permalink,
    ts: new Date(issue.lastSeen).toISOString(),
    detail: issueDetail(issue),
  };
}

/**
 * The time that each poll looks back before the cursor, in milliseconds. Sentry sets `lastSeen`
 * from the event time, which can be before the time that Sentry gets the event.
 */
export const OVERLAP_MS = 5 * 60 * 1000;

function withOverlap(since: string): string {
  return new Date(Date.parse(since) - OVERLAP_MS).toISOString();
}

/** Returns the `sentry api` arguments that get the issues that Sentry saw after `since`. */
export function sentryIssuesArgs(config: SentryConfig, since: string): string[] {
  const projects = config.projects.length > 0 ? ` project:[${config.projects.join(",")}]` : "";
  const query = `is:unresolved lastSeen:>${since}${projects}`;
  return [
    `organizations/${config.org}/issues/`,
    ...["-X", "GET", "-f", `query=${query}`, "-f", "sort=date", "-f", "limit=50"],
  ];
}

/** Runs `sentry api` with `args` and parses the JSON output with `schema`. */
async function sentryApi<T>(runner: CommandRunner, args: string[], schema: z.ZodType<T>) {
  const result = await runner("sentry", ["api", ...args], 30_000);
  if (result.code !== 0) {
    throw new Error(`sentry api failed: ${oneLine(`${result.stderr} ${result.stdout}`)}`);
  }
  return schema.parse(JSON.parse(result.stdout || "null"));
}

/** Returns the Sentry source. It uses the login of the `sentry` CLI. */
export function createSentrySource(
  config: SentryConfig,
  runner: CommandRunner = runCommand,
): Source {
  return {
    async poll(cursor = {}, now) {
      const since = withOverlap(pollStart(cursor.since, now));
      const issues = await sentryApi(runner, sentryIssuesArgs(config, since), issuesSchema);
      const events = issues.flatMap((issue) => sentryEvent(config.org, issue, since) ?? []);
      return { events, cursor: { since: now.toISOString() } };
    },
  };
}

/** The org and short id of a Sentry thread key, or undefined for other keys. */
export function sentryIssueRef(thread: string): { org: string; shortId: string } | undefined {
  const match = /^sentry:([^/]+)\/(.+)$/.exec(thread);
  return match ? { org: match[1] ?? "", shortId: match[2] ?? "" } : undefined;
}

function issueId(event: FactoryEvent): string | undefined {
  return /^sentry-(\d+)-/.exec(event.id)?.[1];
}

function issueOrg(event: FactoryEvent): string | undefined {
  return issueId(event) === undefined ? undefined : sentryIssueRef(event.thread)?.org;
}

function byOrg(events: FactoryEvent[]): Map<string, FactoryEvent[]> {
  const groups = new Map<string, FactoryEvent[]>();
  for (const event of events) {
    const org = issueOrg(event);
    if (org) groups.set(org, [...(groups.get(org) ?? []), event]);
  }
  return groups;
}

/** Returns the `sentry api` arguments that get the status of the issues `ids` of `org`. */
export function sentryStatusArgs(org: string, ids: string[]): string[] {
  const query = `issue.id:[${ids.join(",")}]`;
  return [
    `organizations/${org}/issues/`,
    ...["-X", "GET", "-f", `query=${query}`, "-f", "statsPeriod=90d", "-f", "limit=100"],
  ];
}

async function doneInOrg(runner: CommandRunner, org: string, events: FactoryEvent[]) {
  const ids = [...new Set(events.flatMap((event) => issueId(event) ?? []))];
  const issues = await sentryApi(runner, sentryStatusArgs(org, ids), statusesSchema);
  const done = new Set(
    issues.filter((i) => DONE_STATUSES.includes(i.status ?? "")).map((i) => i.id),
  );
  return events.filter((event) => done.has(issueId(event) ?? "")).map((event) => event.id);
}

/**
 * Returns the inbox actions of Sentry. `dismiss` resolves the issue. `isDone` gets the status of
 * the issues of each org with one call. The poll sets the whole detail.
 */
export function sentryInbox(runner: CommandRunner = runCommand): InboxSource {
  return {
    detail: (event) => Promise.resolve(event.detail),
    async dismiss(event) {
      const ref = sentryIssueRef(event.thread);
      if (!ref) throw new Error(`${event.thread} is not a Sentry issue`);
      const args = [`organizations/${ref.org}/issues/${ref.shortId}/`, "-X", "PUT"];
      await sentryApi(runner, [...args, "-F", "status=resolved"], z.unknown());
    },
    async isDone(events) {
      const groups = [...byOrg(events)];
      const done = await Promise.all(groups.map(([org, list]) => doneInOrg(runner, org, list)));
      return done.flat();
    },
  };
}
