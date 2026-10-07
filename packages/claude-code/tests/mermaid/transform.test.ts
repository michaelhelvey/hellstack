import { expect, test } from "bun:test";
import { render } from "grok-mermaid";

import { drawMermaid } from "../../src/mermaid/transform.ts";

const source = "graph LR\n  A[Start] --> B[End]";
const art = render(source);

test("drawMermaid replaces a Mermaid block with its art", () => {
  const text = drawMermaid(`Before\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nAfter`, render, 200);
  expect(text).toBe(`Before\n\n\`\`\`\`\n${art?.plain.join("\n")}\n\`\`\`\`\n\nAfter`);
});

test("drawMermaid draws a Mermaid block that is not closed", () => {
  const text = drawMermaid(`\`\`\`mermaid\n${source}`, render, 200);
  expect(text).toBe(`\`\`\`\`\n${art?.plain.join("\n")}\n\`\`\`\``);
});

test("drawMermaid keeps the source when the art is wider than the width", () => {
  const markdown = `\`\`\`mermaid\n${source}\n\`\`\``;
  expect(drawMermaid(markdown, render, (art?.width ?? 0) - 1)).toBe(markdown);
});

test("drawMermaid keeps the source when the renderer cannot draw it", () => {
  const markdown = '```mermaid\npie title Pets\n  "Dogs" : 1\n```';
  expect(drawMermaid(markdown, () => null, 200)).toBe(markdown);
});

test("drawMermaid keeps a Mermaid block that is inside another code block", () => {
  const markdown = `~~~~markdown\n\`\`\`mermaid\n${source}\n\`\`\`\n~~~~`;
  expect(drawMermaid(markdown, render, 200)).toBe(markdown);
});

test("drawMermaid uses a fence that is longer than the backticks in the art", () => {
  const backticks = { ...art!, plain: ["a ````` b"] };
  const text = drawMermaid(`\`\`\`mermaid\n${source}\n\`\`\``, () => backticks, 200);
  expect(text).toBe("``````\na ````` b\n``````");
});
