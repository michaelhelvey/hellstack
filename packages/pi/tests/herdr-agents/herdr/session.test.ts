import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readSessionMessages } from "../../../src/herdr-agents/herdr/session.ts";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function entry(role: string, content: unknown, timestamp = "2026-01-01T00:00:00.000Z"): string {
  return JSON.stringify({ type: "message", timestamp, message: { role, content } });
}

const LINES = [
  JSON.stringify({ type: "session", id: "s1" }),
  entry("system", "You are pi."),
  entry("user", [{ type: "text", text: "Review the code" }]),
  entry("assistant", [
    { type: "thinking", thinking: "hmm" },
    { type: "toolCall", name: "read" },
  ]),
  entry("assistant", [
    { type: "text", text: "Found two errors." },
    { type: "text", text: "Both are in a.ts." },
  ]),
  "not json",
];

test("readSessionMessages keeps the text of user and assistant messages", async () => {
  dir = await mkdtemp(path.join(tmpdir(), "session-"));
  const file = path.join(dir, "session.jsonl");

  await Bun.write(file, `${LINES.join("\n")}\n`);

  expect(await readSessionMessages(file)).toEqual([
    { from: "parent", text: "Review the code", at: Date.parse("2026-01-01T00:00:00.000Z") },
    {
      from: "subagent",
      text: "Found two errors.\nBoth are in a.ts.",
      at: Date.parse("2026-01-01T00:00:00.000Z"),
    },
  ]);
});
