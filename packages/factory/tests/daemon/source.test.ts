import { expect, test } from "bun:test";

import { MAX_DETAIL_BODY } from "../../src/core/index.ts";
import { excerpt } from "../../src/daemon/source.ts";

test("excerpt removes HTML comments, HTML tags, and runs of empty lines", () => {
  const text = "<!-- bot -->\r\n<details><summary>Logs</summary>\n\n\n\nfailed</details>";
  expect(excerpt(text)).toBe("Logs\n\nfailed");
});

test("excerpt keeps other text in angle brackets", () => {
  expect(excerpt("use `Promise<string>` and a <b and c> d")).toBe(
    "use `Promise<string>` and a <b and c> d",
  );
});

test("excerpt cuts long text", () => {
  const cut = excerpt("x".repeat(MAX_DETAIL_BODY + 10));
  expect(cut).toHaveLength(MAX_DETAIL_BODY);
  expect(cut.endsWith("\u2026")).toBe(true);
});
