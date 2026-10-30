import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

import {
  readTranscript,
  resolveSession,
  searchSessions,
  summarize,
} from "../../src/session-history/sessions.ts";

let dir: string;
let sessions: SessionInfo[];

function message(timestamp: string, role: string, text: string) {
  return { type: "message", timestamp, message: { role, content: [{ type: "text", text }] } };
}

async function writeSession(id: string, day: string, messages: object[]) {
  const header = {
    type: "session",
    version: 3,
    id,
    timestamp: `${day}T00:00:00.000Z`,
    cwd: "/repo",
  };
  const entries = messages.map((entry, index) => ({
    ...entry,
    id: String(index + 1),
    parentId: index === 0 ? null : String(index),
  }));
  const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
  await writeFile(path.join(dir, `${day}_${id}.jsonl`), `${lines.join("\n")}\n`);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hellstack-session-history-"));
  await writeSession("aaa-old", "2026-01-01", [
    message("2026-01-01T01:00:00.000Z", "user", "add the Parser cache"),
    message("2026-01-01T02:00:00.000Z", "assistant", "cache added to the parser"),
  ]);
  await writeSession("bbb-new", "2026-02-01", [
    message("2026-02-01T01:00:00.000Z", "user", "the parser cache is stale"),
    message("2026-02-01T02:00:00.000Z", "assistant", "fixed the eviction"),
  ]);
  sessions = await SessionManager.list("/repo", dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("summarize puts the newest session first and marks the current session", () => {
  const summaries = summarize(sessions, "aaa-old");

  expect(summaries.map(({ id, current, firstMessage }) => ({ id, current, firstMessage }))).toEqual(
    [
      { id: "bbb-new", current: false, firstMessage: "the parser cache is stale" },
      { id: "aaa-old", current: true, firstMessage: "add the Parser cache" },
    ],
  );
});

test("resolveSession accepts a unique ID prefix and rejects an ambiguous one", () => {
  const withShared = [...sessions, { ...sessions[0]!, id: "bbb-other", path: "/other" }];

  expect(resolveSession(sessions, "aaa").id).toBe("aaa-old");
  expect(() => resolveSession(withShared, "bbb")).toThrow('More than one session matches "bbb".');
  expect(() => resolveSession(sessions, "zzz")).toThrow('No session matches "zzz".');
});

test("searchSessions finds items with all query words in any case, newest first", async () => {
  const hits = await searchSessions(sessions, {
    query: "PARSER cache",
    limit: 10,
    includeTools: false,
    maxChars: 100,
  });

  expect(hits.map(({ sessionId, text }) => ({ sessionId, text }))).toEqual([
    { sessionId: "bbb-new", text: "the parser cache is stale" },
    { sessionId: "aaa-old", text: "cache added to the parser" },
    { sessionId: "aaa-old", text: "add the Parser cache" },
  ]);
});

test("searchSessions stops at the limit", async () => {
  const hits = await searchSessions(sessions, {
    query: "parser",
    limit: 1,
    includeTools: false,
    maxChars: 100,
  });

  expect(hits.map((hit) => hit.sessionId)).toEqual(["bbb-new"]);
});

test("readTranscript reads the items of a session file in order", async () => {
  const session = resolveSession(sessions, "bbb");

  const items = await readTranscript(session.path, { includeTools: false, maxChars: 100 });

  expect(items.map((item) => item.text)).toEqual([
    "the parser cache is stale",
    "fixed the eviction",
  ]);
});
