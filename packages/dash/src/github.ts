import { Context, Effect, Layer, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { exec, execJson } from "./cli.ts";
import type { GithubItem, DashError } from "./item.ts";

const Notification = Schema.Struct({
  id: Schema.String,
  reason: Schema.String,
  updated_at: Schema.String,
  subject: Schema.Struct({
    title: Schema.String,
    url: Schema.NullOr(Schema.String),
    type: Schema.String,
  }),
  repository: Schema.Struct({ full_name: Schema.String, html_url: Schema.String }),
});

const API = String.raw`^https://api\.github\.com/repos/([^/]+/[^/]+)`;

const WEB_URLS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`${API}/pulls/(\\d+)$`), "https://github.com/$1/pull/$2"],
  [new RegExp(`${API}/issues/(\\d+)$`), "https://github.com/$1/issues/$2"],
  [new RegExp(`${API}/commits/(\\w+)$`), "https://github.com/$1/commit/$2"],
];

/**
 * Gives the web URL of a notification subject. Pull requests, issues, and commits get their own
 * page. Other subjects get the page of the repository.
 *
 * @example
 * ```ts
 * webUrl("https://api.github.com/repos/o/r/pulls/7", "https://github.com/o/r");
 * // "https://github.com/o/r/pull/7"
 * ```
 */
export const webUrl = (subjectUrl: string | null, repoUrl: string): string => {
  const url = subjectUrl ?? "";
  const rule = WEB_URLS.find(([pattern]) => pattern.test(url));
  return rule === undefined ? repoUrl : url.replace(rule[0], rule[1]);
};

const toItem = (notification: typeof Notification.Type): GithubItem => ({
  kind: "github",
  id: notification.id,
  title: notification.subject.title,
  url: webUrl(notification.subject.url, notification.repository.html_url),
  repo: notification.repository.full_name,
  reason: notification.reason,
  type: notification.subject.type,
  updatedAt: notification.updated_at,
});

/** The unread GitHub notifications of the user, and the actions on them. */
export class Github extends Context.Service<
  Github,
  {
    /** The unread notification threads, newest first. */
    readonly list: Effect.Effect<ReadonlyArray<GithubItem>, DashError>;
    /** Marks a thread as done, so that it leaves the inbox. */
    readonly done: (id: string) => Effect.Effect<void, DashError>;
  }
>()("hellstack-dash/Github") {
  /** Calls the GitHub API with the `gh` CLI, as the user that `gh` is logged in as. */
  static readonly layer = Layer.effect(
    Github,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return Github.of({
        list: execJson(spawner, Schema.Array(Notification), "gh", [
          "api",
          "/notifications?per_page=50",
        ]).pipe(Effect.map((notifications) => notifications.map(toItem))),
        done: (id) =>
          Effect.asVoid(
            exec(spawner, "gh", ["api", "-X", "DELETE", `/notifications/threads/${id}`]),
          ),
      });
    }),
  );
}
