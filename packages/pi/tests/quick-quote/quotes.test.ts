import { describe, expect, test } from "bun:test";

import {
  blockquote,
  filterQuotes,
  lastReplies,
  paragraphs,
  type Quote,
  quoteTrigger,
} from "../../src/quick-quote/quotes.ts";

function message(role: string, content: unknown) {
  return { type: "message", message: { role, content } };
}

function assistant(text: string) {
  return message("assistant", [{ type: "text", text }]);
}

const MARKDOWN = [
  "# Title",
  "",
  "First paragraph\nstill first.",
  "",
  "- one",
  "- two",
  "",
  "```ts",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  "---",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
].join("\r\n");

describe("paragraphs", () => {
  test("splits list items, and keeps code blocks and tables together", () => {
    expect(paragraphs(MARKDOWN)).toEqual([
      { kind: "heading", text: "# Title" },
      { kind: "paragraph", text: "First paragraph\nstill first." },
      { kind: "list", text: "- one" },
      { kind: "list", text: "- two" },
      { kind: "code", text: "```ts\nconst a = 1;\n\nconst b = 2;\n```" },
      { kind: "table", text: "| a | b |\n| - | - |\n| 1 | 2 |" },
    ]);
  });
});

describe("quoteTrigger", () => {
  test("accepts a search with spaces after >", () => {
    const lines = ["hello", "> git  worktree "];

    expect(quoteTrigger(lines, 1, lines[1]!.length)).toEqual({ row: 1, query: "git  worktree" });
  });

  test("ignores >>, a cursor before the end of the line, and fenced code", () => {
    expect(quoteTrigger([">>x"], 0, 3)).toBeUndefined();
    expect(quoteTrigger(["> abc"], 0, 2)).toBeUndefined();
    expect(quoteTrigger(["```", "> abc"], 1, 5)).toBeUndefined();
    expect(quoteTrigger(["~~~~", "~~~", "> abc"], 2, 5)).toBeUndefined();
    expect(quoteTrigger(["```", "```", "> abc"], 2, 5)).toEqual({ row: 2, query: "abc" });
  });
});

describe("filterQuotes", () => {
  const quotes: Quote[] = [
    { kind: "paragraph", text: "Spočítaj the worktree count" },
    { kind: "paragraph", text: "Prune the branches" },
  ];

  test("matches all words in any order, without case or accents", () => {
    expect(filterQuotes(quotes, "WORKTREE spocitaj")).toEqual([quotes[0]!]);
    expect(filterQuotes(quotes, "the")).toEqual(quotes);
    expect(filterQuotes(quotes, "prune worktree")).toEqual([]);
  });
});

test("blockquote quotes each line and keeps blank lines in the quote", () => {
  expect(blockquote("a\n\nb")).toBe("> a\n>\n> b");
});

describe("lastReplies", () => {
  test("gets the assistant replies after the last answered user message", () => {
    const entries = [
      message("user", "first"),
      assistant("old"),
      message("user", [{ type: "text", text: "second" }]),
      assistant("new 1"),
      message("toolResult", [{ type: "text", text: "tool output" }]),
      message("assistant", [{ type: "toolCall", name: "bash" }]),
      { type: "custom", data: {} },
      assistant("new 2"),
    ];

    expect(lastReplies(entries)).toEqual(["new 1", "new 2"]);
  });

  test("keeps the previous replies while a new user message waits", () => {
    expect(lastReplies([message("user", "a"), assistant("reply"), message("user", "b")])).toEqual([
      "reply",
    ]);
    expect(lastReplies([message("user", "a")])).toEqual([]);
  });
});
