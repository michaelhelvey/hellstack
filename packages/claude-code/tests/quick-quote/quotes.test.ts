import { expect, test } from "bun:test";

import {
  blockquote,
  filterParagraphs,
  label,
  latestParagraphs,
  paragraphs,
  quoteQuery,
} from "../../src/quick-quote/quotes.ts";

function draft(text: string): { text: string; token: string; start: number } {
  const start = text.search(/\S+$/);
  return { text, token: text.slice(start), start };
}

test("paragraphs splits list items and keeps a code block whole", () => {
  const text =
    "First para\nstill first.\n\n- one\n- two\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n";
  expect(paragraphs(text)).toEqual([
    "First para\nstill first.",
    "- one",
    "- two",
    "```ts\nconst a = 1;\n\nconst b = 2;\n```",
  ]);
});

test("latestParagraphs reads all replies to the last prompt and skips tool results", () => {
  const messages = [
    { role: "user", text: "old" },
    { role: "assistant", text: "old reply" },
    { role: "user", text: "new" },
    { role: "assistant", text: "part one" },
    { role: "user", text: "", toolResults: [{}] },
    { role: "assistant", text: "part two" },
  ] as const;
  expect(latestParagraphs(messages)).toEqual(["part one", "part two"]);
});

test("latestParagraphs uses the replies before a prompt that has no reply yet", () => {
  const messages = [
    { role: "user", text: "q" },
    { role: "assistant", text: "answer" },
    { role: "user", text: "next q" },
  ] as const;
  expect(latestParagraphs(messages)).toEqual(["answer"]);
});

test("quoteQuery finds a quote request only at the start of a line", () => {
  expect(quoteQuery(draft(">"))).toBe("");
  expect(quoteQuery(draft("hi\n>cache"))).toBe("cache");
  expect(quoteQuery(draft("hi >cache"))).toBeUndefined();
  expect(quoteQuery(draft(">>cache"))).toBeUndefined();
});

test("quoteQuery ignores open code fences and shell mode", () => {
  expect(quoteQuery(draft("```\n>x"))).toBeUndefined();
  expect(quoteQuery(draft("```\ncode\n```\n>x"))).toBe("x");
  expect(quoteQuery(draft("~~~~\n```\n>x"))).toBeUndefined();
  expect(quoteQuery(draft("!ls\n>x"))).toBeUndefined();
});

test("filterParagraphs needs every word and ignores case and accents", () => {
  const items = ["Spočítaj the Cache", "cache only", "retry"];
  expect(filterParagraphs(items, "spocitaj+cache")).toEqual(["Spočítaj the Cache"]);
  expect(filterParagraphs(items, "CACHE")).toEqual(["Spočítaj the Cache", "cache only"]);
  expect(filterParagraphs(items, "")).toEqual(items);
});

test("blockquote marks empty lines with a bare marker", () => {
  expect(blockquote("a\n\nb")).toBe("> a\n>\n> b");
});

test("label puts the paragraph on one line and cuts long text", () => {
  expect(label("a\n  b")).toBe("a b");
  expect(label("x".repeat(100))).toHaveLength(80);
});
