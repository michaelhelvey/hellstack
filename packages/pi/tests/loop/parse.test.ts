import { expect, test } from "bun:test";

import { parseLoop } from "../../src/loop/index.ts";

test("parseLoop reads an interval and a prompt", () => {
  expect(parseLoop("2h check the PR")).toEqual({
    kind: "fixed",
    seconds: 7200,
    prompt: "check the PR",
  });
});

test("parseLoop makes an interval at least one minute", () => {
  expect(parseLoop("5s ping")).toEqual({ kind: "fixed", seconds: 60, prompt: "ping" });
});

test("parseLoop makes a prompt without an interval self-paced", () => {
  expect(parseLoop(" watch CI ")).toEqual({ kind: "selfPaced", prompt: "watch CI" });
});

test("parseLoop shows the usage for no prompt and for an interval over 24 days", () => {
  expect(parseLoop("")).toEqual({ kind: "usage" });
  expect(parseLoop("5m")).toEqual({ kind: "usage" });
  expect(parseLoop("25d x").kind).toBe("usage");
  expect(parseLoop("stop")).toEqual({ kind: "stop" });
});
