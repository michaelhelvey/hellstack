import { Effect, Layer } from "effect";
import { Atlassian, AtlassianError } from "../src/atlassian.ts";

/** The site of the fake Atlassian service. */
export const SITE = "https://example.atlassian.net";

/** One request that the code sent to the fake Atlassian service. */
export interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

/** Gives the response body for a request. Throw an `AtlassianError` to fail the request. */
export type Respond = (call: Call) => unknown;

/**
 * A fake Atlassian service. `respond` gives the response to each request, and `calls` records the
 * requests in order.
 */
export const fakeAtlassian = (respond: Respond) => {
  const calls: Array<Call> = [];
  const layer = Layer.succeed(
    Atlassian,
    Atlassian.of({
      site: Effect.succeed(SITE),
      text: (request) =>
        Effect.suspend(() => {
          const call: Call = {
            method: request.method ?? "GET",
            path: request.path,
            query: request.query ?? {},
            body: request.body,
          };
          calls.push(call);
          return Effect.try({
            try: () => JSON.stringify(respond(call)) ?? "",
            catch: (error) =>
              error instanceof AtlassianError
                ? error
                : new AtlassianError({ message: String(error) }),
          });
        }),
    }),
  );
  const run = <A>(effect: Effect.Effect<A, AtlassianError, Atlassian>) =>
    Effect.runPromise(Effect.provide(effect, layer));
  const failure = (effect: Effect.Effect<unknown, AtlassianError, Atlassian>) =>
    Effect.runPromise(
      Effect.provide(effect, layer).pipe(
        Effect.match({ onFailure: (error) => error.message, onSuccess: () => "no error" }),
      ),
    );
  return { calls, layer, run, failure };
};

/**
 * Responds from a table of routes such as `"GET /rest/api/3/myself"`. A function value gets the
 * call. A request without a route fails the test.
 */
export const routes =
  (table: Readonly<Record<string, unknown>>): Respond =>
  (call) => {
    const route = `${call.method} ${call.path}`;
    if (!(route in table)) throw new Error(`unexpected request: ${route}`);
    const value = table[route];
    return typeof value === "function" ? value(call) : value;
  };

/** The response of `/rest/api/3/myself`. */
export const ME = {
  accountId: "me",
  displayName: "Me Myself",
  emailAddress: "me@example.com",
  timeZone: "America/New_York",
};
