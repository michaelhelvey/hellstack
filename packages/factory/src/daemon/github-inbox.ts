import { z } from "zod";

import {
  runCommand,
  type CommandRunner,
  type EventDetail,
  type FactoryEvent,
} from "../core/index.ts";
import { listNotifications, MAX_PAGES, PAGE_SIZE } from "./github.ts";
import { excerpt, oneLine, type InboxSource } from "./source.ts";

/** The owner, repository, and number of a GitHub issue or pull request. */
export interface GithubIssueRef {
  owner: string;
  repo: string;
  number: number;
}

const issueSchema = z.object({
  state: z.string(),
  body: z.string().nullish(),
  user: z.object({ login: z.string() }),
  pull_request: z.object({ merged_at: z.string().nullish() }).nullish(),
});

const graphqlSchema = z.object({
  data: z
    .record(
      z.string(),
      z.object({ issueOrPullRequest: z.object({ state: z.string() }).nullable() }).nullable(),
    )
    .nullish(),
});

/** Returns the issue or pull request of a GitHub thread key, or undefined for other keys. */
export function githubIssueRef(thread: string): GithubIssueRef | undefined {
  const match = /^gh:([^/#]+)\/([^/#]+)#(\d+)$/.exec(thread);
  if (!match) return undefined;
  return { owner: match[1] ?? "", repo: match[2] ?? "", number: Number(match[3]) };
}

/** Returns the id of the notification thread of a GitHub event, or undefined. */
export function notificationThreadId(event: FactoryEvent): string | undefined {
  return /^gh-(\d+)-/.exec(event.id)?.[1];
}

async function gh(runner: CommandRunner, args: string[]): Promise<string> {
  const result = await runner("gh", args, 30_000);
  if (result.code !== 0) throw new Error(`gh ${args[1] ?? ""} failed: ${oneLine(result.stderr)}`);
  return result.stdout;
}

async function githubDetail(runner: CommandRunner, event: FactoryEvent): Promise<EventDetail> {
  const ref = githubIssueRef(event.thread);
  if (!ref) return { ...event.detail };
  const path = `repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  const issue = issueSchema.parse(JSON.parse(await gh(runner, ["api", path])));
  const state = issue.pull_request?.merged_at ? "merged" : issue.state;
  return { author: issue.user.login, body: excerpt(issue.body ?? ""), ...event.detail, state };
}

/** Returns a GraphQL query that gets the state of each issue or pull request, as `s<index>`. */
export function stateQuery(refs: GithubIssueRef[]): string {
  const fields = refs.map(
    (ref, index) =>
      `s${index}: repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) { issueOrPullRequest(number: ${ref.number}) { ... on Issue { state } ... on PullRequest { state } } }`,
  );
  return `query { ${fields.join(" ")} }`;
}

/**
 * Returns the threads whose issue or pull request is closed or merged, with one GraphQL call. A
 * repository that GitHub cannot find gives an error for its part only, so it reads the output also
 * when `gh` fails.
 */
async function closedThreads(runner: CommandRunner, events: FactoryEvent[]): Promise<Set<string>> {
  const threads = [...new Set(events.map((event) => event.thread))].filter(githubIssueRef);
  if (threads.length === 0) return new Set();
  const refs = threads.flatMap((thread) => githubIssueRef(thread) ?? []);
  const args = ["api", "graphql", "-f", `query=${stateQuery(refs)}`];
  const result = await runner("gh", args, 30_000);
  const data = graphqlSchema.parse(JSON.parse(result.stdout || "{}")).data;
  if (!data) throw new Error(`gh api graphql failed: ${oneLine(result.stderr)}`);
  return new Set(threads.filter((_, i) => isClosed(data[`s${i}`]?.issueOrPullRequest?.state)));
}

function isClosed(state: string | undefined): boolean {
  return state !== undefined && state !== "OPEN";
}

function oldest(events: FactoryEvent[]): string {
  const first = events.reduce((min, event) => (event.ts < min ? event.ts : min), "9999");
  return new Date(Date.parse(first) - 1000).toISOString();
}

/**
 * Returns the ids of the events whose notification thread the user marked done: the thread is not
 * in the notification list. When the list is longer than one read, it returns nothing.
 */
async function doneThreads(runner: CommandRunner, events: FactoryEvent[]): Promise<Set<string>> {
  const list = await listNotifications(runner, oldest(events), new Date());
  if (list.length >= MAX_PAGES * PAGE_SIZE) return new Set();
  const present = new Set(list.map((n) => n.id));
  const done = events.filter((event) => !present.has(notificationThreadId(event) ?? ""));
  return new Set(done.map((event) => event.id));
}

/**
 * Returns the inbox actions of GitHub. `detail` adds the state of the issue or pull request, and
 * its author and text when the poll had no comment. `dismiss` marks the notification thread done.
 * `isDone` uses one GraphQL call and one notification list.
 */
export function githubInbox(runner: CommandRunner = runCommand): InboxSource {
  return {
    detail: (event) => githubDetail(runner, event),
    async dismiss(event) {
      const id = notificationThreadId(event);
      if (!id) throw new Error(`event ${event.id} has no GitHub notification thread`);
      await gh(runner, ["api", "-X", "DELETE", `notifications/threads/${id}`]);
    },
    async isDone(events) {
      if (events.length === 0) return [];
      const [closed, done] = await Promise.all([
        closedThreads(runner, events),
        doneThreads(runner, events),
      ]);
      return events.filter((e) => closed.has(e.thread) || done.has(e.id)).map((e) => e.id);
    },
  };
}
