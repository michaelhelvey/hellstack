import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

import { buildWebFetchArgs, formatWebFetchOutput } from "../../src/web-fetch/run.ts";

test("buildWebFetchArgs puts the URL after the end of options, so a URL cannot be read as an option", () => {
  expect(buildWebFetchArgs({ url: "--help" })).toEqual(["--", "--help"]);
});

test("buildWebFetchArgs includes each optional flag that is set", () => {
  const args = buildWebFetchArgs({
    url: "https://example.com",
    full: true,
    selector: "main",
    wait_ms: 0,
    fail_on_http_error: true,
  });
  expect(args).toEqual([
    "--full",
    "--selector",
    "main",
    "--wait-ms",
    "0",
    "--fail-on-http-error",
    "--",
    "https://example.com",
  ]);
});

test("formatWebFetchOutput returns short output without change", async () => {
  const output = await formatWebFetchOutput("# Title\n\nBody");
  expect(output).toEqual({
    text: "# Title\n\nBody",
    truncated: false,
    fullOutputPath: undefined,
  });
});

test("formatWebFetchOutput saves the full output to a file when the output is too long", async () => {
  const page = Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, i) => `line ${i}`).join("\n");
  const output = await formatWebFetchOutput(page);
  expect(output.truncated).toBe(true);
  expect(output.text).toContain(`Full output saved to: ${output.fullOutputPath}`);
  expect(output.text).not.toContain(`line ${DEFAULT_MAX_LINES + 5}`);
  expect(await readFile(output.fullOutputPath ?? "", "utf8")).toBe(page);
});
