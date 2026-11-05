import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { CommandResult } from "../../src/core/index.ts";
import {
  createGithubSource,
  githubEvent,
  notificationSchema,
  PAGE_SIZE,
  parseGhResponse,
  type Notification,
} from "../../src/daemon/github.ts";

const fixtureText = await readFile(
  new URL("fixtures/github-notifications.json", import.meta.url),
  "utf8",
);
const notifications = z.array(notificationSchema).parse(JSON.parse(fixtureText));

const checkSuite: Notification = {
  id: "200001",
  reason: "ci_activity",
  updated_at: "2026-11-05T14:00:00Z",
  subject: { title: "CI failed", url: null, latest_comment_url: null, type: "CheckSuite" },
  repository: { full_name: "acme/repo-1", html_url: "https://github.com/acme/repo-1" },
};

describe("github normalization", () => {
  test("maps reason and subject type to the event kind and thread", () => {
    expect(notifications.map((n) => githubEvent(n)).map((e) => [e.kind, e.thread, e.url])).toEqual([
      ["review_requested", "gh:acme/repo-1#332", "https://github.com/acme/repo-1/pull/332"],
      ["pr_comment", "gh:acme/repo-2#112", "https://github.com/acme/repo-2/pull/112"],
      ["pr_update", "gh:acme/repo-3#47", "https://github.com/acme/repo-3/pull/47"],
      ["pr_update", "gh:acme/repo-3#46", "https://github.com/acme/repo-3/pull/46"],
      ["pr_comment", "gh:acme/repo-4#68", "https://github.com/acme/repo-4/pull/68"],
      ["state_change", "gh:acme/repo-5#8", "https://github.com/acme/repo-5/pull/8"],
    ]);
  });

  test("the event id has the update time and the summary falls back to the reason", () => {
    const first = githubEvent(notifications[0] as Notification);
    expect(first).toMatchObject({
      id: "gh-100001-20261105T142927Z",
      source: "github",
      title: "Add the router",
      summary: "review requested: Add the router",
      ts: "2026-11-05T14:29:27Z",
    });
  });

  test("a subject without a number gets the repository thread", () => {
    expect(githubEvent(checkSuite)).toMatchObject({
      kind: "ci",
      thread: "gh:acme/repo-1",
      url: "https://github.com/acme/repo-1",
    });
  });

  test("a review comment is a review", () => {
    const subject = {
      ...checkSuite.subject,
      type: "PullRequest",
      url: "https://api.github.com/repos/acme/repo-1/pulls/9",
      latest_comment_url: "https://api.github.com/repos/acme/repo-1/pulls/comments/77",
    };
    expect(githubEvent({ ...checkSuite, reason: "author", subject }).kind).toBe("review");
  });

  test("parses the output of gh api -i", () => {
    const response = parseGhResponse(
      "HTTP/2.0 304 Not Modified\r\nX-Poll-Interval: 60\r\nLast-Modified: Thu, 05 Nov 2026 14:21:03 GMT\r\n\r\n",
    );
    expect(response).toEqual({
      status: 304,
      headers: { "x-poll-interval": "60", "last-modified": "Thu, 05 Nov 2026 14:21:03 GMT" },
      body: "",
    });
  });
});

describe("github source", () => {
  function fakeGh(status: string) {
    const calls: string[][] = [];
    function runner(_program: string, args: string[]): Promise<CommandResult> {
      calls.push(args);
      const comment = { body: "Please\nrename x", user: { login: "someone" } };
      if (args[1] !== "-i")
        return Promise.resolve({ code: 0, stdout: JSON.stringify(comment), stderr: "" });
      const body = status.startsWith("200") ? fixtureText : "";
      const head = `HTTP/2.0 ${status}\nLast-Modified: Thu, 05 Nov 2026 14:30:00 GMT\nX-Poll-Interval: 90\n\n`;
      return Promise.resolve({
        code: status.startsWith("200") ? 0 : 1,
        stdout: head + body,
        stderr: `gh: HTTP ${status}`,
      });
    }
    return { runner, calls };
  }

  test("polls since the cursor and keeps the poll interval and Last-Modified", async () => {
    const { runner, calls } = fakeGh("200 OK");
    const poll = await createGithubSource(runner).poll(
      undefined,
      new Date("2026-11-05T15:00:00.000Z"),
    );
    expect(calls[0]).toContain("since=2026-11-05T14:00:00.000Z");
    expect(calls[0]?.join(" ")).not.toContain("If-Modified-Since");
    expect(poll.minIntervalSeconds).toBe(90);
    expect(poll.cursor).toEqual({
      since: "2026-11-05T14:29:27Z",
      lastModified: "Thu, 05 Nov 2026 14:30:00 GMT",
    });
    expect(poll.events.find((e) => e.id.startsWith("gh-100005"))?.summary).toBe(
      "@someone: Please rename x",
    );
  });

  test("a 304 has no events and keeps the cursor", async () => {
    const { runner, calls } = fakeGh("304 Not Modified");
    const cursor = { since: "2026-11-05T14:29:27Z", lastModified: "Thu, 05 Nov 2026 14:30:00 GMT" };
    const poll = await createGithubSource(runner).poll(cursor, new Date());
    expect(calls[0]).toContain("If-Modified-Since: Thu, 05 Nov 2026 14:30:00 GMT");
    expect(poll.events).toEqual([]);
    expect(poll.cursor).toEqual(cursor);
  });

  test("another status is an error", async () => {
    const { runner } = fakeGh("401 Unauthorized");
    const error = await createGithubSource(runner)
      .poll(undefined, new Date())
      .catch((e: unknown) => e);
    expect(String(error)).toContain("HTTP 401");
  });

  test("reads the next pages while each page is full", async () => {
    function page(offset: number, count: number): Notification[] {
      return Array.from({ length: count }, (_, index) => ({
        ...checkSuite,
        id: String(offset + index),
      }));
    }
    const calls: string[][] = [];
    function runner(_program: string, args: string[]): Promise<CommandResult> {
      calls.push(args);
      const number = Number(args.find((arg) => arg.startsWith("page="))?.slice(5) ?? 1);
      const body = JSON.stringify(page(number * 100, number === 1 ? PAGE_SIZE : 3));
      const stdout = args[1] === "-i" ? `HTTP/2.0 200 OK\n\n${body}` : body;
      return Promise.resolve({ code: 0, stdout, stderr: "" });
    }
    const poll = await createGithubSource(runner).poll(undefined, new Date());
    expect(poll.events).toHaveLength(PAGE_SIZE + 3);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("page=2");
  });
});
