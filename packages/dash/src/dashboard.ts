import { Context, Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { exec } from "./cli.ts";
import { Github } from "./github.ts";
import { HiddenStore } from "./hidden.ts";
import type { ActionName, DashError, Item } from "./item.ts";
import { Sentry } from "./sentry.ts";

/** An action on one row. `run` does the action. */
export interface Action {
  readonly name: ActionName;
  readonly run: Effect.Effect<void, DashError>;
}

/** One item and the actions that the user can do on it. */
export interface Row {
  readonly item: Item;
  readonly actions: ReadonlyArray<Action>;
}

/** The rows of all sources, the number of hidden items, and the sources that failed. */
export interface Snapshot {
  readonly rows: ReadonlyArray<Row>;
  readonly hidden: number;
  readonly errors: ReadonlyArray<string>;
}

interface Part {
  readonly rows: ReadonlyArray<Row>;
  readonly errors: ReadonlyArray<string>;
}

const settle = (rows: Effect.Effect<ReadonlyArray<Row>, DashError>): Effect.Effect<Part> =>
  Effect.match(rows, {
    onSuccess: (rows) => ({ rows, errors: [] }),
    onFailure: (error) => ({ rows: [], errors: [error.message] }),
  });

/**
 * The data of the dashboard. The UI uses only this service, and does not know where the items come
 * from.
 *
 * @example
 * ```ts
 * const dashboard = yield* Dashboard;
 * const snapshot = yield* dashboard.load;
 * yield* snapshot.rows[0].actions[0].run;
 * ```
 */
export class Dashboard extends Context.Service<
  Dashboard,
  {
    /** Gets the items of all sources. A source that fails gives no rows and one error. */
    readonly load: Effect.Effect<Snapshot>;
    readonly hiddenCount: Effect.Effect<number, DashError>;
    /** Shows the hidden items again on the next `load`. */
    readonly clearHidden: Effect.Effect<void, DashError>;
    /** Opens the web page of the item in the browser. */
    readonly open: (item: Item) => Effect.Effect<void, DashError>;
  }
>()("hellstack-dash/Dashboard") {
  /** Uses the `Github` and `Sentry` sources, and removes the hidden Sentry issues. */
  static readonly layer = Layer.effect(
    Dashboard,
    Effect.gen(function* () {
      const github = yield* Github;
      const sentry = yield* Sentry;
      const hidden = yield* HiddenStore;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const githubRows = Effect.map(github.list, (items) =>
        items.map((item) => ({
          item,
          actions: [{ name: "done" as const, run: github.done(item.id) }],
        })),
      );

      const sentryRows = Effect.gen(function* () {
        const ids = yield* hidden.list;
        const items = yield* sentry.list;
        return items
          .filter((item) => !ids.has(item.id))
          .map((item) => ({
            item,
            actions: [
              { name: "resolve" as const, run: sentry.resolve(item.id) },
              { name: "hide" as const, run: hidden.hide(item.id) },
            ],
          }));
      });

      const load = Effect.gen(function* () {
        const parts = yield* Effect.all([settle(githubRows), settle(sentryRows)], {
          concurrency: "unbounded",
        });
        const hiddenCount = yield* Effect.orElseSucceed(
          Effect.map(hidden.list, (ids) => ids.size),
          () => 0,
        );
        const snapshot: Snapshot = {
          rows: parts.flatMap((part) => part.rows),
          hidden: hiddenCount,
          errors: parts.flatMap((part) => part.errors),
        };
        yield* Effect.logInfo("loaded", { rows: snapshot.rows.length, errors: snapshot.errors });
        return snapshot;
      });

      return Dashboard.of({
        load,
        hiddenCount: Effect.map(hidden.list, (ids) => ids.size),
        clearHidden: hidden.clear,
        open: (item) => Effect.asVoid(exec(spawner, "open", [item.url])),
      });
    }),
  );
}
