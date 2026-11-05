import { describe, expect, test } from "bun:test";

import type { CommandResult } from "../../src/core/index.ts";
import { summarize, templateSummary, type FeedFacts } from "../../src/daemon/summary.ts";

const quiet: FeedFacts = {
  ts: "2026-11-05T14:00:00.000Z",
  source: "github",
  ok: true,
  new: 0,
  routed: [],
  ignored: 0,
};
const busy: FeedFacts = {
  ...quiet,
  new: 3,
  ignored: 1,
  routed: [
    { thread: "gh:acme/api#1", kind: "mention", to: "inbox" },
    { thread: "gh:acme/api#2", kind: "pr_comment", to: "factory-t-7f3a" },
  ],
};

function runner(reply: { code: number; stdout: string } | Error) {
  const calls: string[][] = [];
  function run(program: string, args: string[]): Promise<CommandResult> {
    calls.push([program, ...args]);
    return reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve({ ...reply, stderr: "" });
  }
  return { run, calls };
}

describe("summary", () => {
  test("the template tells the counts and the targets", () => {
    expect(templateSummary(quiet)).toBe("No new github events.");
    expect(templateSummary(busy)).toBe(
      "3 new github events, routed 2 to inbox, factory-t-7f3a, 1 ignored.",
    );
    expect(templateSummary({ ...quiet, ok: false, error: "HTTP 401" })).toBe(
      "The github poll failed: HTTP 401.",
    );
  });

  test("a quiet cycle does not call the model", async () => {
    const { run, calls } = runner({ code: 0, stdout: "x" });
    expect(await summarize(quiet, [], { model: "haiku", runner: run })).toBe(
      "No new github events.",
    );
    expect(calls).toEqual([]);
  });

  test("a busy cycle asks the model without tools, extensions, or sessions", async () => {
    const { run, calls } = runner({ code: 0, stdout: "  Two events came in.\n" });
    expect(await summarize(busy, ["Add the router"], { model: "haiku", runner: run })).toBe(
      "Two events came in.",
    );
    expect(calls[0]?.slice(0, 9)).toEqual([
      ...["pi", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills"],
      ...["--no-context-files", "--no-prompt-templates", "--model"],
    ]);
  });

  test("falls back to the template when the model fails", async () => {
    const failed = runner(new Error("timeout"));
    expect(await summarize(busy, [], { model: "haiku", runner: failed.run })).toBe(
      templateSummary(busy),
    );
    const empty = runner({ code: 1, stdout: "" });
    expect(await summarize(busy, [], { model: "haiku", runner: empty.run })).toBe(
      templateSummary(busy),
    );
  });
});
