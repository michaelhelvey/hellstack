import { Effect, type Result } from "effect";
import { Dashboard } from "../dashboard.ts";
import type { DashError } from "../item.ts";

/**
 * Runs an effect from the UI, with the services and the loggers of the program that started the
 * UI. A failure gives the error message.
 */
export type Run = <A>(effect: Effect.Effect<A, DashError>) => Promise<Result.Result<A, string>>;

/** What the UI needs from the program: the dashboard and a way to run its effects. */
export interface Connection {
  readonly dashboard: Dashboard["Service"];
  readonly run: Run;
}

/**
 * Gets the `Dashboard` and a `Run` function that uses the current services.
 *
 * @example
 * ```ts
 * const connection = yield* connect;
 * await render(() => <App {...connection} pollMs={60_000} />);
 * ```
 */
export const connect: Effect.Effect<Connection, never, Dashboard> = Effect.gen(function* () {
  const dashboard = yield* Dashboard;
  const services = yield* Effect.context();
  const run: Run = (effect) =>
    Effect.runPromiseWith(services)(
      Effect.result(Effect.mapError(effect, (error) => error.message)),
    );
  return { dashboard, run };
});
