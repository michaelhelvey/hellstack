import { z } from "zod";

/** The sources that make events. */
export const eventSourceSchema = z.enum(["github", "sentry"]);

/** A source that makes events. */
export type FactoryEventSource = z.infer<typeof eventSourceSchema>;

/** An event id. It is safe to use as a file name: it does not start with a dot. */
export const eventIdSchema = z.string().regex(/^[\w-][\w.-]*$/, "not a valid event id");

/** The maximum length of {@link EventDetail.body}. */
export const MAX_DETAIL_BODY = 1500;

/**
 * What the board shows about an inbox event without a network call: the author, a plain text
 * excerpt of the comment, review, or issue, the state of the subject (for example `open`, `merged`,
 * `closed`, `unresolved`, `resolved`), and the repository or project.
 */
export const eventDetailSchema = z.object({
  author: z.string().optional(),
  body: z.string().max(MAX_DETAIL_BODY).optional(),
  state: z.string().optional(),
  repo: z.string().optional(),
});

/** What the board shows about an inbox event. */
export type EventDetail = z.infer<typeof eventDetailSchema>;

/**
 * A normalized record from a source. `id` is unique and safe to use as a file name. A source can
 * set `detail` when it polls; factoryd completes it before it writes the event to the inbox.
 */
export const eventSchema = z.object({
  id: eventIdSchema,
  source: eventSourceSchema,
  thread: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  url: z.string(),
  ts: z.iso.datetime(),
  detail: eventDetailSchema.optional(),
});

/** A normalized record from a source. */
export type FactoryEvent = z.infer<typeof eventSchema>;

/** Returns the thread key of a GitHub issue or pull request. */
export function githubThread(owner: string, repo: string, number: number): string {
  return `gh:${owner}/${repo}#${number}`;
}

/** Returns the thread key of a Sentry issue. */
export function sentryThread(org: string, shortId: string): string {
  return `sentry:${org}/${shortId}`;
}

/** Returns the thread key of a task. */
export function taskThread(id: string): string {
  return `task:${id}`;
}

/**
 * Returns the thread key of a GitHub subject without a number, for example a CI run. Its thread is
 * the repository.
 */
export function githubRepoThread(owner: string, repo: string): string {
  return `gh:${owner}/${repo}`;
}

/** Returns the `owner/repo` part of a GitHub thread key, or undefined for other keys. */
export function threadRepo(thread: string): string | undefined {
  return /^gh:([^/#]+\/[^/#]+)(?:#\d+)?$/.exec(thread)?.[1];
}
