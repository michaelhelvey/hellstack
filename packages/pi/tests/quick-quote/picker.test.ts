import { beforeAll, describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { MAX_ROWS, preview, renderPicker, segments, spans } from "../../src/quick-quote/picker.ts";
import type { Quote } from "../../src/quick-quote/quotes.ts";
import { testTheme } from "../shared/theme.ts";

let theme: Theme;

beforeAll(async () => {
  theme = await testTheme();
});

function quotes(count: number): Quote[] {
  return Array.from({ length: count }, (_, i) => ({ kind: "paragraph", text: `quote ${i + 1}` }));
}

function plain(lines: string[]): string[] {
  return lines.map((line) => Bun.stripANSI(line));
}

describe("preview", () => {
  test("removes Markdown markers and joins the lines", () => {
    expect(preview({ kind: "list", text: "- [x] done\n  item" })).toBe("done item");
    expect(preview({ kind: "list", text: "12) twelve" })).toBe("twelve");
    expect(preview({ kind: "heading", text: "## Title" })).toBe("Title");
    expect(preview({ kind: "quote", text: "> a\n> b" })).toBe("a b");
    expect(preview({ kind: "code", text: "```ts\nconst a = **1**;\n```" })).toBe(
      "const a = **1**;",
    );
  });

  test("removes emphasis and links, and keeps inline code", () => {
    const text = "Use **bold**, _it_, [docs](https://x.y), and `a_b*c*` in snake_case.";

    expect(preview({ kind: "paragraph", text })).toBe(
      "Use bold, it, docs, and `a_b*c*` in snake_case.",
    );
  });
});

test("spans splits inline code from the other text", () => {
  expect(spans("run `git prune` now")).toEqual([
    { text: "run ", code: false },
    { text: "git prune", code: true },
    { text: " now", code: false },
  ]);
});

test("segments marks each match of each word", () => {
  expect(segments("Prune the prune", ["prune"])).toEqual([
    { text: "Prune", match: true },
    { text: " the ", match: false },
    { text: "prune", match: true },
  ]);
});

describe("renderPicker", () => {
  test("draws each line at the full width", () => {
    const matches: Quote[] = [{ kind: "paragraph", text: "x".repeat(200) }, ...quotes(2)];
    const lines = renderPicker({ matches, selected: 1, offset: 0, query: "" }, theme, 60);

    expect(lines.map(visibleWidth)).toEqual(Array<number>(5).fill(60));
    expect(plain(lines)[0]).toContain("2/3");
    expect(plain(lines)[1]).toEndWith("x… │");
    expect(plain(lines)[2]).toStartWith("│▌ ¶ quote 1");
  });

  test("shows the rows from the offset, at most MAX_ROWS", () => {
    const view = { matches: quotes(20), selected: 12, offset: 5, query: "" };
    const rows = plain(renderPicker(view, theme, 40)).slice(1, -1);

    expect(rows).toHaveLength(MAX_ROWS);
    expect(rows[0]).toContain("quote 6 ");
    expect(rows.at(-1)).toContain("quote 13 ");
  });

  test("shows a message when nothing matches, and nothing in a narrow editor", () => {
    const view = { matches: [], selected: 0, offset: 0, query: "zzz" };

    expect(plain(renderPicker(view, theme, 40))[1]).toContain("no paragraphs match");
    expect(renderPicker(view, theme, 10)).toEqual([]);
  });
});
