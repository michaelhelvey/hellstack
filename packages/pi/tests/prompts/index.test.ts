import { expect, test } from "bun:test";

import { promptSections } from "../../src/prompts/index.ts";

test("promptSections has the instructions with the pi notes, and the chinchilla voice", () => {
  const sections = promptSections();
  expect(Object.keys(sections)).toEqual(["instructions", "chinchilla"]);
  expect(sections["instructions"]).toContain("## Tool Use in pi");
});
