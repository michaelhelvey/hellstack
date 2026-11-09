import { expect, test } from "bun:test";
import { adfToText, textToAdf } from "../src/adf.ts";

const text = (value: string, marks?: ReadonlyArray<unknown>) => ({
  type: "text",
  text: value,
  marks,
});
const paragraph = (...content: ReadonlyArray<unknown>) => ({ type: "paragraph", content });
const item = (...content: ReadonlyArray<unknown>) => ({ type: "listItem", content });

test("adfToText keeps the structure of a description as Markdown", () => {
  const doc = {
    type: "doc",
    version: 1,
    content: [
      { type: "heading", attrs: { level: 2 }, content: [text("Goal")] },
      paragraph(
        text("Call "),
        text("run()", [{ type: "code" }]),
        text(" with "),
        { type: "mention", attrs: { text: "@Ann" } },
        { type: "hardBreak" },
        text("docs", [{ type: "link", attrs: { href: "https://example.com" } }]),
      ),
      {
        type: "orderedList",
        content: [
          item(paragraph(text("one")), {
            type: "bulletList",
            content: [item(paragraph(text("nested")))],
          }),
          item(paragraph(text("two"))),
        ],
      },
      { type: "codeBlock", attrs: { language: "sql" }, content: [text("select 1;")] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [paragraph(text("Field"))] },
              { type: "tableHeader", content: [paragraph(text("Value"))] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph(text("a|b"))] },
              { type: "tableCell", content: [paragraph(text("x")), paragraph(text("y"))] },
            ],
          },
        ],
      },
    ],
  };
  expect(adfToText(doc)).toBe(
    [
      "## Goal",
      "",
      "Call `run()` with @Ann",
      "[docs](https://example.com)",
      "",
      "1. one",
      "   - nested",
      "2. two",
      "",
      "```sql",
      "select 1;",
      "```",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| a\\|b | x<br>y |",
    ].join("\n"),
  );
});

test("adfToText gives an empty string for a missing value and keeps a plain string", () => {
  expect(adfToText(null)).toBe("");
  expect(adfToText(undefined)).toBe("");
  expect(adfToText("plain")).toBe("plain");
});

test("textToAdf makes paragraphs from blank lines and hard breaks from other line breaks", () => {
  expect(textToAdf("a\nb\n\nc")).toEqual({
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "c" }] },
    ],
  });
});
