import { expect, test } from "bun:test";

import { activeBranch, parseEntries, toTranscript } from "../../src/session-history/transcript.ts";

const T = "2026-01-01T00:00:00.000Z";

const raw = [
  { type: "session", version: 3, id: "s1", timestamp: T, cwd: "/repo" },
  { type: "model_change", id: "a", parentId: null, timestamp: T, provider: "p", modelId: "m" },
  {
    type: "message",
    id: "b",
    parentId: "a",
    timestamp: T,
    message: { role: "user", content: "fix the parser" },
  },
  {
    type: "message",
    id: "c",
    parentId: "b",
    timestamp: T,
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "looking" },
        { type: "toolCall", id: "t1", name: "read", arguments: { path: "parser.ts" } },
      ],
    },
  },
  {
    type: "message",
    id: "d",
    parentId: "c",
    timestamp: T,
    message: {
      role: "toolResult",
      toolName: "read",
      isError: true,
      content: [{ type: "text", text: "ENOENT" }],
    },
  },
  {
    type: "message",
    id: "x",
    parentId: "b",
    timestamp: T,
    message: { role: "user", content: "abandoned" },
  },
  {
    type: "compaction",
    id: "e",
    parentId: "d",
    timestamp: T,
    summary: "parser work so far",
    firstKeptEntryId: "b",
  },
];

test("activeBranch follows the parent links from the last entry and skips other branches", () => {
  const ids = activeBranch(parseEntries(raw)).map((entry) => entry.id);

  expect(ids).toEqual(["a", "b", "c", "d", "e"]);
});

test("toTranscript keeps user and assistant text and summaries, without thinking or tools", () => {
  const items = toTranscript(activeBranch(parseEntries(raw)), {
    includeTools: false,
    maxChars: 100,
  });

  expect(items.map(({ role, text }) => ({ role, text }))).toEqual([
    { role: "user", text: "fix the parser" },
    { role: "assistant", text: "looking" },
    { role: "summary", text: "parser work so far" },
  ]);
});

test("toTranscript shows tool calls and tool results when includeTools is set", () => {
  const items = toTranscript(activeBranch(parseEntries(raw)), {
    includeTools: true,
    maxChars: 100,
  });

  expect(items.map((item) => item.text)).toEqual([
    "fix the parser",
    'looking\n[tool call] read {"path":"parser.ts"}',
    "read (error): ENOENT",
    "parser work so far",
  ]);
});

test("toTranscript shortens long text to maxChars", () => {
  const entries = parseEntries([
    {
      type: "message",
      id: "a",
      parentId: null,
      timestamp: T,
      message: { role: "user", content: "x".repeat(30) },
    },
  ]);

  const [item] = toTranscript(entries, { includeTools: false, maxChars: 10 });

  expect(item?.text).toBe(`${"x".repeat(10)}… [20 more chars]`);
});
