import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";
import { Atlassian, AtlassianAuth, type ApiRequest, request } from "../src/atlassian.ts";

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

type Respond = (url: URL) => readonly [number, string];

const bodyText = (req: HttpClientRequest.HttpClientRequest) =>
  "body" in req.body && req.body.body instanceof Uint8Array
    ? new TextDecoder().decode(req.body.body)
    : "";

/** A fake HTTP client. `respond` gives the status and the body for each request URL. */
const fakeHttp = (respond: Respond) => {
  const sent: Array<Sent> = [];
  const client = HttpClient.make((req, url) => {
    const authorization = req.headers["authorization"];
    sent.push({ method: req.method, url: url.toString(), authorization, body: bodyText(req) });
    const [status, text] = respond(url);
    return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(text, { status })));
  });
  return { sent, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const BASIC = `Basic ${btoa("me@example.com:secret")}`;

const client = (respond: Respond) => {
  const http = fakeHttp(respond);
  const credentials = AtlassianAuth.fixed({
    site: "https://example.atlassian.net",
    email: "me@example.com",
    token: Redacted.make("secret"),
  });
  const layer = Atlassian.layer.pipe(Layer.provide(credentials), Layer.provide(http.layer));
  const send = (input: ApiRequest) => Effect.provide(request(input), layer);
  return { sent: http.sent, send };
};

const fetchText = (text: string) =>
  Effect.runPromise(client(() => [200, text]).send({ path: "/x" }));

describe("Atlassian", () => {
  test("sends JSON with basic auth and the query, and parses the JSON response", async () => {
    const { sent, send } = client(() => [200, '{"ok":true}']);
    const body = await Effect.runPromise(
      send({
        method: "POST",
        path: "/wiki/rest/api/user/bulk",
        query: { accountId: ["a", "b"], limit: 5 },
        body: { x: 1 },
      }),
    );
    expect(body).toEqual({ ok: true });
    expect(sent).toEqual([
      {
        method: "POST",
        url: "https://example.atlassian.net/wiki/rest/api/user/bulk?accountId=a&accountId=b&limit=5",
        authorization: BASIC,
        body: '{"x":1}',
      },
    ]);
  });

  test("gives a text body as text and an empty body as null", async () => {
    expect(await fetchText("flowchart TD")).toBe("flowchart TD");
    expect(await fetchText("")).toBeNull();
  });

  test("fails with the status and the body of an HTTP error", async () => {
    const { send } = client(() => [404, '{"errorMessages":["Issue does not exist"]}']);
    const error = await Effect.runPromise(
      send({ path: "/rest/api/3/issue/X-1" }).pipe(
        Effect.match({ onFailure: (failure) => failure, onSuccess: () => null }),
      ),
    );
    expect(error?.status).toBe(404);
    expect(error?.message).toBe(
      'GET /rest/api/3/issue/X-1 failed with HTTP 404: {"errorMessages":["Issue does not exist"]}',
    );
  });
});

/** Finds the credentials with the environment `env`. Gives the error message on a failure. */
const credentials = (env: Record<string, string>, respond: Respond) => {
  const http = fakeHttp(respond);
  const config = Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }));
  const layer = AtlassianAuth.layer.pipe(Layer.provide(http.layer), Layer.provide(config));
  const result = Effect.runPromise(
    AtlassianAuth.use((auth) => auth.credentials).pipe(
      Effect.map((c) => ({
        site: c.site,
        email: c.email,
        tokenIsSecret: Redacted.value(c.token) === "secret",
      })),
      Effect.catchTag("AtlassianError", (error) => Effect.succeed(error.message)),
      Effect.provide(layer),
    ),
  );
  return { sent: http.sent, result };
};

const EMAIL_ONLY = { JIRA_API_TOKEN: "secret", JIRA_USER_EMAIL: "me@example.com" };

describe("AtlassianAuth", () => {
  test("uses JIRA_BASE_URL without a probe", async () => {
    const { sent, result } = credentials(
      { ...EMAIL_ONLY, JIRA_BASE_URL: "https://x.atlassian.net/" },
      () => [500, ""],
    );
    expect(await result).toEqual({
      site: "https://x.atlassian.net",
      email: "me@example.com",
      tokenIsSecret: true,
    });
    expect(sent).toEqual([]);
  });

  test("tries the site of the email domain when JIRA_BASE_URL is not set", async () => {
    const { sent, result } = credentials(EMAIL_ONLY, () => [200, "{}"]);
    expect(await result).toMatchObject({ site: "https://example.atlassian.net" });
    expect(sent.map((s) => [s.url, s.authorization])).toEqual([
      ["https://example.atlassian.net/rest/api/3/myself", BASIC],
    ]);
  });

  test("asks for JIRA_BASE_URL when the guessed site refuses the credentials", async () => {
    const { result } = credentials(EMAIL_ONLY, () => [401, ""]);
    expect(await result).toBe(
      "https://example.atlassian.net does not accept these credentials: set JIRA_BASE_URL to the site",
    );
  });

  test("asks for a token when there is none", async () => {
    const { result } = credentials({ JIRA_USER_EMAIL: "me@example.com" }, () => [200, "{}"]);
    expect(await result).toBe("set JIRA_API_TOKEN (or JIRA_API_KEY) to an Atlassian API token");
  });
});
