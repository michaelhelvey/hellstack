import { Context, Effect, Layer, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { exec, execJson } from "./cli.ts";
import type { SentryItem, DashError } from "./item.ts";

const ORG = "transport4";
const QUERY = "is:unresolved lastSeen:-24h";

const Issue = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  shortId: Schema.String,
  permalink: Schema.String,
  count: Schema.FiniteFromString,
  lastSeen: Schema.String,
  project: Schema.Struct({ slug: Schema.String }),
});

const toItem = (issue: typeof Issue.Type): SentryItem => ({
  kind: "sentry",
  id: issue.id,
  title: issue.title,
  url: issue.permalink,
  project: issue.project.slug,
  shortId: issue.shortId,
  count: issue.count,
  lastSeen: issue.lastSeen,
});

/** The Sentry issues of the organization that are unresolved and recent, and the actions on them. */
export class Sentry extends Context.Service<
  Sentry,
  {
    /** The unresolved issues of all projects that occurred in the last 24 hours, last seen first. */
    readonly list: Effect.Effect<ReadonlyArray<SentryItem>, DashError>;
    /** Sets the status of an issue to resolved. */
    readonly resolve: (id: string) => Effect.Effect<void, DashError>;
  }
>()("hellstack-dash/Sentry") {
  /** Calls the Sentry API with the `sentry` CLI, as the user that the CLI is logged in as. */
  static readonly layer = Layer.effect(
    Sentry,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return Sentry.of({
        list: execJson(spawner, Schema.Array(Issue), "sentry", [
          "api",
          `organizations/${ORG}/issues/`,
          "-f",
          `query=${QUERY}`,
          "-f",
          "sort=date",
          "-f",
          "project=-1",
          "-f",
          "limit=100",
        ]).pipe(Effect.map((issues) => issues.map(toItem))),
        resolve: (id) =>
          Effect.asVoid(
            exec(spawner, "sentry", ["api", `issues/${id}/`, "-X", "PUT", "-F", "status=resolved"]),
          ),
      });
    }),
  );
}
