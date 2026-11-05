import { expect, test } from "bun:test";

import { runCommand } from "../../src/core/command.ts";

test("the command gets an empty stdin and does not wait for input", async () => {
  expect(await runCommand("cat", [], 2_000)).toEqual({ code: 0, stdout: "", stderr: "" });
});

test("a nonzero exit code does not reject", async () => {
  expect((await runCommand("sh", ["-c", "echo no >&2; exit 3"], 2_000)).code).toBe(3);
});
