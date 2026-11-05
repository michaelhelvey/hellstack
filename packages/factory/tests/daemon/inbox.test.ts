import { describe, expect, test } from "bun:test";

import { listInbox, writeInbox } from "../../src/core/index.ts";
import { dismissInbox, pruneInbox, withDetail } from "../../src/daemon/inbox.ts";
import { tempLedger } from "../core/helpers.ts";
import { event, fakeInbox } from "./helpers.ts";

const events = [
  event({ id: "a", thread: "gh:acme/api#1", ts: "2026-11-05T14:01:00Z" }),
  event({ id: "b", thread: "gh:acme/api#1", ts: "2026-11-05T14:02:00Z" }),
  event({ id: "c", thread: "gh:acme/api#2", ts: "2026-11-05T14:03:00Z" }),
  event({ id: "s", source: "sentry", thread: "sentry:acme/API-1", ts: "2026-11-05T14:04:00Z" }),
];

async function ledger() {
  const paths = await tempLedger();
  for (const item of events) await writeInbox(item, paths);
  return paths;
}

async function ids(paths: Awaited<ReturnType<typeof ledger>>) {
  return (await listInbox(paths)).map((item) => item.id).sort();
}

describe("dismissInbox", () => {
  test("does the source action, then removes the events of the thread", async () => {
    const paths = await ledger();
    const inbox = fakeInbox();
    await dismissInbox(paths, inbox.sources, "a");
    expect(inbox.calls).toEqual(["dismiss a"]);
    expect(await ids(paths)).toEqual(["c", "s"]);
  });

  test("keeps the inbox when the source action fails, and fails for an unknown id", async () => {
    const paths = await ledger();
    const { sources } = fakeInbox();
    sources.github = { ...sources.github, dismiss: () => Promise.reject(new Error("HTTP 404")) };
    expect(await dismissInbox(paths, sources, "a").catch(String)).toContain("HTTP 404");
    expect(await dismissInbox(paths, sources, "zz").catch(String)).toContain("no event zz");
    expect(await ids(paths)).toEqual(["a", "b", "c", "s"]);
  });
});

describe("pruneInbox", () => {
  test("removes the done events and keeps the events of a source that fails", async () => {
    const paths = await ledger();
    const { sources, calls } = fakeInbox(["b", "c", "s"]);
    sources.sentry = { ...sources.sentry, isDone: () => Promise.reject(new Error("offline")) };
    const result = await pruneInbox(paths, sources);
    expect(calls).toEqual(["isDone a,b,c"]);
    expect(result.removed.map((item) => item.id)).toEqual(["b", "c"]);
    expect(result.errors).toEqual(["sentry: offline"]);
    expect(await ids(paths)).toEqual(["a", "s"]);
  });
});

test("withDetail keeps the detail of the poll when the source fails", async () => {
  const { sources } = fakeInbox();
  const item = event({ detail: { repo: "acme/api" } });
  expect((await withDetail(sources, item)).detail).toEqual({ repo: "acme/api", state: "open" });
  sources.github = { ...sources.github, detail: () => Promise.reject(new Error("down")) };
  expect((await withDetail(sources, item)).detail).toEqual({ repo: "acme/api" });
});
