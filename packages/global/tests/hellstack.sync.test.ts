import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { agentsText, personalEmail, t4Email } from "../hellstack.sync.ts";

const base = await readFile(join(import.meta.dir, "..", "AGENTS.md"), "utf8");

test("agentsText keeps the personal email without the t4 layer", () => {
  expect(agentsText(base, new Set())).toBe(base);
});

test("agentsText puts the t4 email in place of the personal email with the t4 layer", () => {
  const text = agentsText(base, new Set(["t4"]));
  expect(text).toContain(t4Email);
  expect(text).not.toContain(personalEmail);
});

test("agentsText rejects a text without the personal email", () => {
  expect(() => agentsText("# agents\n", new Set(["t4"]))).toThrow();
});
