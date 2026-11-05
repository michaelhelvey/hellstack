import { describe, expect, test } from "bun:test";

import type { CommandResult, FactoryEvent } from "../../src/core/index.ts";
import { githubInbox, githubIssueRef, stateQuery } from "../../src/daemon/github-inbox.ts";
import { MAX_PAGES, PAGE_SIZE } from "../../src/daemon/github.ts";
import { event, fakeRunner } from "./helpers.ts";

function ghEvent(thread: string, notification: string, fields: Partial<FactoryEvent> = {}) {
  return event({ id: `gh-${notification}-20261105T142103Z`, thread, ...fields });
}

function notifications(ids: string[]): string {
  return JSON.stringify(
    ids.map((id) => ({
      id,
      reason: "comment",
      updated_at: "2026-11-05T14:21:03Z",
      subject: { title: "t", url: null, latest_comment_url: null, type: "PullRequest" },
      repository: { full_name: "acme/api", html_url: "https://github.com/acme/api" },
    })),
  );
}

describe("githubIssueRef", () => {
  test("reads issue thread keys only", () => {
    expect(githubIssueRef("gh:acme/api#88")).toEqual({ owner: "acme", repo: "api", number: 88 });
    expect(githubIssueRef("gh:acme/api")).toBeUndefined();
    expect(githubIssueRef("sentry:acme/API-1")).toBeUndefined();
  });
});

describe("github inbox detail", () => {
  test("adds the state of the pull request and keeps the comment of the poll", async () => {
    const issue = { state: "closed", body: "PR text", user: { login: "author" } };
    const merged = { ...issue, pull_request: { merged_at: "2026-11-05T15:00:00Z" } };
    const { runner, calls } = fakeRunner({ stdout: JSON.stringify(merged) });
    const comment = { author: "someone", body: "please rename x", repo: "acme/api" };
    const detail = await githubInbox(runner).detail(
      ghEvent("gh:acme/api#88", "1", { detail: comment }),
    );
    expect(calls).toEqual([["gh", "api", "repos/acme/api/issues/88"]]);
    expect(detail).toEqual({ ...comment, state: "merged" });
  });

  test("uses the author and the text of the issue when the poll had no comment", async () => {
    const issue = {
      state: "open",
      body: "<!-- hidden -->Steps:\n\n\n\n1. log in",
      user: { login: "a" },
    };
    const { runner } = fakeRunner({ stdout: JSON.stringify(issue) });
    const detail = await githubInbox(runner).detail(
      ghEvent("gh:acme/api#9", "1", { detail: { repo: "acme/api" } }),
    );
    expect(detail).toEqual({
      author: "a",
      body: "Steps:\n\n1. log in",
      state: "open",
      repo: "acme/api",
    });
  });

  test("a thread without a number keeps the detail of the poll and makes no call", async () => {
    const { runner, calls } = fakeRunner();
    const detail = await githubInbox(runner).detail(
      ghEvent("gh:acme/api", "1", { detail: { repo: "acme/api" } }),
    );
    expect(detail).toEqual({ repo: "acme/api" });
    expect(calls).toEqual([]);
  });
});

describe("github inbox dismiss", () => {
  test("marks the notification thread done", async () => {
    const { runner, calls } = fakeRunner();
    await githubInbox(runner).dismiss(ghEvent("gh:acme/api#88", "4242"));
    expect(calls).toEqual([["gh", "api", "-X", "DELETE", "notifications/threads/4242"]]);
  });

  test("fails when gh fails or the event has no notification thread", async () => {
    const { runner } = fakeRunner({ code: 1, stderr: "gh: Not Found (HTTP 404)" });
    const failed = await githubInbox(runner).dismiss(ghEvent("gh:acme/api#88", "1")).catch(String);
    expect(failed).toContain("HTTP 404");
    const other = await githubInbox(runner)
      .dismiss(event({ id: "manual-1" }))
      .catch(String);
    expect(other).toContain("has no GitHub notification thread");
  });
});

const graphql: Partial<CommandResult> = {
  code: 1,
  stdout: JSON.stringify({
    data: {
      s0: { issueOrPullRequest: { state: "MERGED" } },
      s1: { issueOrPullRequest: { state: "OPEN" } },
      s2: null,
    },
  }),
  stderr: "gh: Could not resolve to a Repository",
};

describe("github inbox isDone", () => {
  test("a closed or merged subject and a thread that the user marked done are done", async () => {
    const { runner, calls } = fakeRunner(graphql, { stdout: notifications(["1", "2"]) });
    const events = [
      ghEvent("gh:acme/api#1", "1"),
      ghEvent("gh:acme/api#2", "2"),
      ghEvent("gh:acme/api#2", "3"),
      ghEvent("gh:gone/repo#3", "2"),
      ghEvent("gh:acme/api", "2"),
    ];
    expect(await githubInbox(runner).isDone(events)).toEqual([
      "gh-1-20261105T142103Z",
      "gh-3-20261105T142103Z",
    ]);
    expect(calls[0]?.slice(0, 3)).toEqual(["gh", "api", "graphql"]);
    expect(calls[1]).toContain("since=2026-11-05T14:21:02.000Z");
  });

  test("when one check fails, the other check is enough; when both fail, it throws", async () => {
    const listFails = fakeRunner(graphql, { code: 1, stderr: "HTTP 502" });
    const events = [ghEvent("gh:acme/api#1", "1")];
    expect(await githubInbox(listFails.runner).isDone(events)).toEqual(["gh-1-20261105T142103Z"]);
    const bothFail = fakeRunner({ code: 1, stdout: "" }, { code: 1, stderr: "HTTP 502" });
    expect(await githubInbox(bothFail.runner).isDone(events).catch(String)).toContain("failed");
  });

  test("a notification list that is longer than one read marks nothing done", async () => {
    const page = notifications(Array.from({ length: PAGE_SIZE }, (_, i) => String(1000 + i)));
    const pages = Array.from({ length: MAX_PAGES }, () => ({ stdout: page }));
    const { runner, calls } = fakeRunner(...pages);
    expect(await githubInbox(runner).isDone([ghEvent("gh:acme/api", "1")])).toEqual([]);
    expect(calls).toHaveLength(MAX_PAGES);
  });

  test("the query asks for each subject with an alias", () => {
    const query = stateQuery([{ owner: "acme", repo: "api", number: 7 }]);
    expect(query).toBe(
      'query { s0: repository(owner: "acme", name: "api") { issueOrPullRequest(number: 7) { ... on Issue { state } ... on PullRequest { state } } } }',
    );
  });

  test("no events make no calls", async () => {
    const { runner, calls } = fakeRunner();
    expect(await githubInbox(runner).isDone([])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
