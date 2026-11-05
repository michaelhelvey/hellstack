import { z } from "zod";

/** The sources that make events. */
export const eventSourceSchema = z.enum(["github", "sentry"]);

/** An event id. It is safe to use as a file name: it does not start with a dot. */
export const eventIdSchema = z.string().regex(/^[\w-][\w.-]*$/, "not a valid event id");

/** A normalized record from a source. `id` is unique and safe to use as a file name. */
export const eventSchema = z.object({
  id: eventIdSchema,
  source: eventSourceSchema,
  thread: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  url: z.string(),
  ts: z.iso.datetime(),
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

/** Returns the `owner/repo` part of a GitHub thread key, or undefined for other keys. */
export function threadRepo(thread: string): string | undefined {
  return /^gh:([^/#]+\/[^/#]+)#\d+$/.exec(thread)?.[1];
}
