import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

/** A failed request to Atlassian Cloud, or a problem with the credentials or the response. */
export class AtlassianError extends Schema.TaggedError<
  AtlassianError,
  { readonly brand: unique symbol }
>()("AtlassianError", {
  message: Schema.String,
  status: Schema.optional(Schema.Int),
}) {}

/** The site and the credentials for Atlassian Cloud. */
export interface Credentials {
  /** The site URL without a trailing slash, for example `https://example.atlassian.net`. */
  readonly site: string;
  readonly email: string;
  readonly token: Redacted.Redacted;
}

/** The HTTP methods that the Atlassian REST APIs use. */
export type Method = "GET" | "POST" | "PUT" | "DELETE";

/** One request to the Jira or Confluence REST API. */
export interface ApiRequest {
  readonly method?: Method | undefined;
  /** The path relative to the site, for example `/rest/api/3/myself`. It can include a query. */
  readonly path: string;
  /** Query parameters. An array gives the parameter one time for each value. */
  readonly query?:
    | Readonly<Record<string, string | number | boolean | ReadonlyArray<string>>>
    | undefined;
  readonly body?: unknown;
}

/** Gives the value of an effect, and keeps it after the first success. A failure is not kept. */
const cacheSuccess = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Ref.make(Option.none<A>()), (ref) =>
    Effect.flatMap(
      Ref.get(ref),
      Option.match({
        onSome: Effect.succeed,
        onNone: () => Effect.tap(effect, (value) => Ref.set(ref, Option.some(value))),
      }),
    ),
  );

const fail = (message: string) => Effect.fail(new AtlassianError({ message }));

const run = promisify(execFile);

/** The global git email, or an empty string. Pi runs on Node, so this does not use Bun APIs. */
const gitEmail = Effect.tryPromise(() => run("git", ["config", "--global", "user.email"])).pipe(
  Effect.map((output) => output.stdout.trim()),
  Effect.orElseSucceed(() => ""),
);

const optional = (...names: ReadonlyArray<string>) =>
  Config.option(
    names
      .map((name) => Config.String(name))
      .reduce((first, next) => Config.orElse(first, () => next)),
  );

const readToken = Config.Redacted("JIRA_API_TOKEN").pipe(
  Config.orElse(() => Config.Redacted("JIRA_API_KEY")),
  Effect.mapError(
    () =>
      new AtlassianError({
        message: "set JIRA_API_TOKEN (or JIRA_API_KEY) to an Atlassian API token",
      }),
  ),
);

/**
 * The Atlassian site and credentials. The live layer finds them on the first call and keeps them
 * after the first success.
 */
export class AtlassianAuth extends Context.Service<
  AtlassianAuth,
  { readonly credentials: Effect.Effect<Credentials, AtlassianError> }
>()("hellstack-jira/AtlassianAuth") {
  /**
   * Finds the credentials:
   *
   * - The token comes from `JIRA_API_TOKEN` or `JIRA_API_KEY`.
   * - The email comes from `JIRA_USER_EMAIL`, `JIRA_EMAIL`, or `git config --global user.email`.
   * - The site comes from `JIRA_BASE_URL`. If it is not set, the layer tries
   *   `https://<first part of the email domain>.atlassian.net`.
   */
  static readonly layer = Layer.effect(
    AtlassianAuth,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const config = yield* ConfigProvider.ConfigProvider;

      const readEmail = Effect.gen(function* () {
        const configured = yield* optional("JIRA_USER_EMAIL", "JIRA_EMAIL");
        const email = Option.isSome(configured) ? configured.value : yield* gitEmail;
        return email === ""
          ? yield* fail("no Atlassian email: set JIRA_USER_EMAIL to the email of your account")
          : email;
      });

      const probe = (site: string, email: string, token: Redacted.Redacted) =>
        http.execute(
          HttpClientRequest.get(`${site}/rest/api/3/myself`).pipe(
            HttpClientRequest.basicAuth(email, token),
          ),
        );

      const findSite = Effect.fnUntraced(function* (email: string, token: Redacted.Redacted) {
        const configured = yield* optional("JIRA_BASE_URL");
        if (Option.isSome(configured)) return configured.value.replace(/\/+$/, "");
        const site = guessSite(email);
        const response = yield* Effect.option(probe(site, email, token));
        return Option.exists(response, (r) => r.status === 200)
          ? site
          : yield* fail(`${site} does not accept these credentials: set JIRA_BASE_URL to the site`);
      });

      const resolve = Effect.gen(function* () {
        const token = yield* readToken;
        const email = yield* readEmail;
        const site = yield* findSite(email, token);
        return { site, email, token };
      }).pipe(
        Effect.catchTag("ConfigError", (error) => fail(`bad Atlassian config: ${error.message}`)),
        Effect.provideService(ConfigProvider.ConfigProvider, config),
      );

      return AtlassianAuth.of({ credentials: yield* cacheSuccess(resolve) });
    }),
  );

  /** Uses the given credentials. */
  static readonly fixed = (credentials: Credentials) =>
    Layer.succeed(AtlassianAuth, AtlassianAuth.of({ credentials: Effect.succeed(credentials) }));
}

const guessSite = (email: string) => {
  const domain = email.split("@")[1] ?? "";
  return `https://${domain.split(".")[0]}.atlassian.net`;
};

const methodOf = (request: ApiRequest): Method => request.method ?? "GET";

const toHttpRequest = ({ site, email, token }: Credentials, request: ApiRequest) => {
  const base = HttpClientRequest.make(methodOf(request))(
    `${site}/${request.path.replace(/^\/+/, "")}`,
    { urlParams: request.query ?? {}, acceptJson: true },
  ).pipe(HttpClientRequest.basicAuth(email, token));
  return request.body === undefined ? base : HttpClientRequest.bodyJsonUnsafe(base, request.body);
};

const parseBody = (text: string): unknown => {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const failure = (request: ApiRequest, response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(response.text, (body) =>
    Effect.fail(
      new AtlassianError({
        message: `${methodOf(request)} ${request.path} failed with HTTP ${response.status}: ${body.slice(0, 2000)}`,
        status: response.status,
      }),
    ),
  );

/** Sends requests to the Jira and Confluence REST APIs of the Atlassian site. */
export class Atlassian extends Context.Service<
  Atlassian,
  {
    /** The site URL, for example `https://example.atlassian.net`. */
    readonly site: Effect.Effect<string, AtlassianError>;
    /** Sends a request and gives the response body as text. A status of 400 or more fails. */
    text(request: ApiRequest): Effect.Effect<string, AtlassianError>;
  }
>()("hellstack-jira/Atlassian") {
  /** Sends the requests with the `HttpClient` and the credentials from `AtlassianAuth`. */
  static readonly layer = Layer.effect(
    Atlassian,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const auth = yield* AtlassianAuth;

      const send = Effect.fnUntraced(function* (request: ApiRequest) {
        const response = yield* http.execute(toHttpRequest(yield* auth.credentials, request));
        return response.status >= 400 ? yield* failure(request, response) : yield* response.text;
      });

      const text = (input: ApiRequest) =>
        send(input).pipe(
          Effect.catchTag("HttpClientError", (error) =>
            fail(`${methodOf(input)} ${input.path} failed: ${error.message}`),
          ),
        );

      return Atlassian.of({ site: Effect.map(auth.credentials, (c) => c.site), text });
    }),
  );
}

/** Sends a request. Gives the JSON body, the text body if it is not JSON, or null if empty. */
export const request = (input: ApiRequest) =>
  Effect.map(
    Atlassian.use((atlassian) => atlassian.text(input)),
    parseBody,
  );

/** Sends a request and decodes the response with the schema. */
export const call = <S extends Schema.Top>(schema: S, input: ApiRequest) =>
  request(input).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.catchTag("SchemaError", (error) =>
      fail(`unexpected response from ${input.path}: ${error.message}`),
    ),
  );

/** Sends a GET request and decodes the response with the schema. */
export const get = <S extends Schema.Top>(schema: S, path: string, query?: ApiRequest["query"]) =>
  call(schema, { path, query });
