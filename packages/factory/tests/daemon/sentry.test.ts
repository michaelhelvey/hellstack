import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { sentrySourceSchema } from "../../src/core/config.ts";
import {
  createSentrySource,
  sentryEvent,
  sentryInbox,
  sentryIssuesArgs,
  sentryIssueSchema,
} from "../../src/daemon/sentry.ts";
import { event, fakeRunner } from "./helpers.ts";

const fixtureText = await readFile(new URL("fixtures/sentry-issues.json", import.meta.url), "utf8");
const issues = z.array(sentryIssueSchema).parse(JSON.parse(fixtureText));
const config = sentrySourceSchema.parse({ type: "sentry", org: "acme", projects: ["api", "web"] });
const since = "2026-11-05T14:00:00.000Z";

function sentryEventOf(id: string, shortId: string, org = "acme") {
  return event({ id: `sentry-${id}-new`, source: "sentry", thread: `sentry:${org}/${shortId}` });
}

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
      detail: {
        body: "in src/orders/handler.ts in getOrder\n12 events",
        state: "unresolved",
        repo: "api",
      },
    });
  });

  test("the arguments filter by project and last seen time", () => {
    expect(sentryIssuesArgs(config, since)).toEqual([
      "organizations/acme/issues/",
      ...["-X", "GET", "-f", `query=is:unresolved lastSeen:>${since} project:[api,web]`],
      ...["-f", "sort=date", "-f", "limit=50"],
    ]);
  });
});

describe("sentry source", () => {
  test("runs sentry api and moves the cursor to the poll time", async () => {
    const { runner, calls } = fakeRunner({ stdout: fixtureText });
    const now = new Date("2026-11-05T15:00:00.000Z");
    const poll = await createSentrySource(config, runner).poll({ since }, now);
    expect(calls[0]?.slice(0, 3)).toEqual(["sentry", "api", "organizations/acme/issues/"]);
    expect(calls[0]).toContain(
      "query=is:unresolved lastSeen:>2026-11-05T13:55:00.000Z project:[api,web]",
    );
    expect(poll.events).toHaveLength(2);
    expect(poll.cursor).toEqual({ since: now.toISOString() });
  });

  test("fails with the CLI error", async () => {
    const { runner } = fakeRunner({ code: 60, stdout: '{"detail":"Not found"}' });
    const error = await createSentrySource(config, runner)
      .poll(undefined, new Date())
      .catch(String);
    expect(error).toContain("sentry api failed");
    expect(error).toContain("Not found");
  });
});

describe("sentry inbox", () => {
  test("dismiss resolves the issue of the thread", async () => {
    const { runner, calls } = fakeRunner({ stdout: "{}" });
    await sentryInbox(runner).dismiss(sentryEventOf("41", "API-1A"));
    expect(calls).toEqual([
      ["sentry", "api", "organizations/acme/issues/API-1A/", "-X", "PUT", "-F", "status=resolved"],
    ]);
  });

  test("isDone asks once per org and returns the resolved and ignored issues", async () => {
    const statuses = [
      { id: "41", status: "resolved" },
      { id: "42", status: "unresolved" },
      { id: "43", status: "ignored" },
    ];
    const { runner, calls } = fakeRunner({ stdout: JSON.stringify(statuses) }, { stdout: "[]" });
    const events = [
      sentryEventOf("41", "API-1"),
      sentryEventOf("42", "API-2"),
      sentryEventOf("43", "API-3"),
      sentryEventOf("44", "WEB-1", "other"),
    ];
    expect(await sentryInbox(runner).isDone(events)).toEqual(["sentry-41-new", "sentry-43-new"]);
    expect(calls.map((call) => call[2])).toEqual([
      "organizations/acme/issues/",
      "organizations/other/issues/",
    ]);
    expect(calls[0]).toContain("query=issue.id:[41,42,43]");
  });

  test("detail is the detail of the poll", async () => {
    const detail = { state: "unresolved", repo: "api" };
    const { runner, calls } = fakeRunner();
    expect(await sentryInbox(runner).detail({ ...sentryEventOf("41", "A"), detail })).toEqual(
      detail,
    );
    expect(calls).toEqual([]);
  });
});
