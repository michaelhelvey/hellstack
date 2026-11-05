import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { sentrySourceSchema } from "../../src/core/config.ts";
import {
  createSentrySource,
  sentryEvent,
  sentryIssuesUrl,
  sentryIssueSchema,
} from "../../src/daemon/sentry.ts";

const fixtureText = await readFile(new URL("fixtures/sentry-issues.json", import.meta.url), "utf8");
const issues = z.array(sentryIssueSchema).parse(JSON.parse(fixtureText));
const config = sentrySourceSchema.parse({
  type: "sentry",
  org: "acme",
  projects: ["api", "web"],
  tokenEnv: "TEST_SENTRY_TOKEN",
});
const since = "2026-11-05T14:00:00.000Z";

afterEach(() => {
  delete process.env.TEST_SENTRY_TOKEN;
});

describe("sentry normalization", () => {
  test("new and regressed issues are events; other issues are not", () => {
    const events = issues.map((issue) => sentryEvent("acme", issue, since));
    expect(events.map((e) => e && [e.id, e.kind, e.thread])).toEqual([
      ["sentry-4100000001-new", "issue_new", "sentry:acme/API-1A"],
      ["sentry-4100000002-regression", "issue_regression", "sentry:acme/API-0Z"],
      undefined,
    ]);
    expect(events[0]).toMatchObject({
      summary:
        "api: TypeError: Cannot read properties of undefined (reading 'id') in src/orders/handler.ts in getOrder (12 events)",
      url: "https://acme.sentry.io/issues/4100000001/",
      ts: "2026-11-05T14:20:44.101Z",
    });
  });

  test("the URL filters by project and last seen time", () => {
    const url = new URL(sentryIssuesUrl(config, since));
    expect(url.pathname).toBe("/api/0/organizations/acme/issues/");
    expect(url.searchParams.get("query")).toBe(
      `is:unresolved lastSeen:>${since} project:[api,web]`,
    );
  });
});

describe("sentry source", () => {
  test("sends the token and moves the cursor to the poll time", async () => {
    process.env.TEST_SENTRY_TOKEN = "secret";
    const headers: Record<string, string>[] = [];
    function fetcher(_url: string, init: { headers: Record<string, string> }): Promise<Response> {
      headers.push(init.headers);
      return Promise.resolve(new Response(fixtureText));
    }
    const now = new Date("2026-11-05T15:00:00.000Z");
    const poll = await createSentrySource(config, fetcher).poll({ since }, now);
    expect(headers).toEqual([{ Authorization: "Bearer secret" }]);
    expect(poll.events).toHaveLength(2);
    expect(poll.cursor).toEqual({ since: now.toISOString() });
  });

  test("fails when the token variable is not set", async () => {
    const source = createSentrySource(config, () => Promise.reject(new Error("no call")));
    const error = await source.poll(undefined, new Date()).catch((e: unknown) => e);
    expect(String(error)).toContain("TEST_SENTRY_TOKEN is not set");
  });
});
