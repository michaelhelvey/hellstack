import { z } from "zod";

import { sentryThread, type FactoryEvent, type SourceConfig } from "../core/index.ts";
import { oneLine, pollStart, type Source } from "./source.ts";

/** An issue of the Sentry issues API. */
export const sentryIssueSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string(),
  culprit: z.string().nullish(),
  permalink: z.string(),
  firstSeen: z.iso.datetime({ offset: true }),
  lastSeen: z.iso.datetime({ offset: true }),
  substatus: z.string().nullish(),
  count: z.string().nullish(),
  project: z.object({ slug: z.string() }),
});

/** An issue of the Sentry issues API. */
export type SentryIssue = z.infer<typeof sentryIssueSchema>;

/** The config of the Sentry source. */
export type SentryConfig = Extract<SourceConfig, { type: "sentry" }>;

/** Gets a URL with headers. Tests give a fake. */
export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

function issueKind(issue: SentryIssue, since: string): string | undefined {
  if (Date.parse(issue.firstSeen) >= Date.parse(since)) return "issue_new";
  return issue.substatus === "regressed" ? "issue_regression" : undefined;
}

function issueSummary(issue: SentryIssue): string {
  const where = issue.culprit ? ` in ${issue.culprit}` : "";
  return oneLine(`${issue.project.slug}: ${issue.title}${where} (${issue.count ?? "?"} events)`);
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
  };
}

/** Returns the URL of the issues that Sentry saw after `since` in the projects of `config`. */
export function sentryIssuesUrl(config: SentryConfig, since: string): string {
  const projects = config.projects.length > 0 ? ` project:[${config.projects.join(",")}]` : "";
  const query = `is:unresolved lastSeen:>${since}${projects}`;
  const params = new URLSearchParams({ query, sort: "date", limit: "50" });
  return `${config.url}/api/0/organizations/${config.org}/issues/?${params.toString()}`;
}

/** Returns the Sentry source. It reads the token from the variable that `tokenEnv` names. */
export function createSentrySource(config: SentryConfig, fetcher: Fetch = fetch): Source {
  return {
    async poll(cursor = {}, now) {
      const token = process.env[config.tokenEnv];
      if (!token) throw new Error(`${config.tokenEnv} is not set`);
      const since = pollStart(cursor.since, now);
      const headers = { Authorization: `Bearer ${token}` };
      const response = await fetcher(sentryIssuesUrl(config, since), { headers });
      if (!response.ok)
        throw new Error(`sentry: HTTP ${response.status}: ${oneLine(await response.text())}`);
      const issues = z.array(sentryIssueSchema).parse(await response.json());
      const events = issues.flatMap((issue) => sentryEvent(config.org, issue, since) ?? []);
      return { events, cursor: { since: now.toISOString() } };
    },
  };
}
