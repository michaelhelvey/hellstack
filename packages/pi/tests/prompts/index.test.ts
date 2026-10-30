import { expect, test } from "bun:test";

import { promptSections } from "../../src/prompts/index.ts";

test("promptSections has no pstack section when pi does not load the pstack skills", () => {
  const sections = promptSections({ subagent: false, sheet: undefined, pstack: false });
  expect(Object.keys(sections)).toEqual(["instructions", "chinchilla"]);
});

test("promptSections has a pstack section when pi loads the pstack skills", () => {
  const sections = promptSections({ subagent: false, sheet: "- roles: a/b", pstack: true });
  expect(sections["pstack"]).toContain("- roles: a/b");
});
