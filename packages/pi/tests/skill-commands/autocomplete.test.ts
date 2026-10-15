import { describe, expect, test } from "bun:test";

import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

import {
  renameSkillItems,
  skillAutocomplete,
  slashToken,
} from "../../src/skill-commands/autocomplete.ts";
import type { SkillCommand } from "../../src/skill-commands/skills.ts";

const SKILLS: SkillCommand[] = [
  { name: "jira", description: "Jira things.", filePath: "/s/jira/SKILL.md" },
  { name: "browser", description: undefined, filePath: "/s/browser/SKILL.md" },
];

const BASE_ITEM: AutocompleteItem = { value: "base", label: "base" };

const base: AutocompleteProvider = {
  triggerCharacters: ["#"],
  getSuggestions: () => Promise.resolve({ items: [BASE_ITEM], prefix: "x" }),
  applyCompletion: (lines) => ({ lines: [...lines, "base"], cursorLine: 0, cursorCol: 0 }),
};

const provider = skillAutocomplete(() => SKILLS)(base);

async function suggest(text: string, force = false) {
  const lines = text.split("\n");
  const line = lines.length - 1;
  const col = lines[line]?.length ?? 0;

  return provider.getSuggestions(lines, line, col, { signal: new AbortController().signal, force });
}

describe("slashToken", () => {
  test("finds the token at the cursor, and if it is at the start of the message", () => {
    expect(slashToken(["  /ji"], 0, 5)).toEqual({ query: "ji", atStart: true });
    expect(slashToken(["fix (/ji"], 0, 8)).toEqual({ query: "ji", atStart: false });
    expect(slashToken(["a", "/"], 1, 1)).toEqual({ query: "", atStart: false });
  });

  test("finds nothing in a path or after a space", () => {
    expect(slashToken(["src/ji"], 0, 6)).toBeUndefined();
    expect(slashToken(["/jira x"], 0, 7)).toBeUndefined();
  });
});

test("renameSkillItems shows skills as /name, unless a command has the name", () => {
  const items = [
    { value: "skill:jira", label: "skill:jira", description: "d" },
    { value: "skill:model", label: "skill:model" },
    { value: "model", label: "model" },
  ];

  expect(renameSkillItems({ items, prefix: "/" })?.items).toEqual([
    { value: "jira", label: "jira", description: "d" },
    { value: "model", label: "model" },
  ]);
});

describe("skillAutocomplete", () => {
  test("shows matching skills for a token after the start", async () => {
    expect(await suggest("look at /ji")).toEqual({
      items: [{ value: "jira", label: "jira", description: "Jira things." }],
      prefix: "/ji",
    });
    expect(await suggest("look at /zzz")).toBeNull();
  });

  test("uses the base provider in other places", async () => {
    expect((await suggest("/ji"))?.items).toEqual([BASE_ITEM]);
    expect((await suggest("look at /zzz", true))?.items).toEqual([BASE_ITEM]);
    expect((await suggest("plain"))?.items).toEqual([BASE_ITEM]);
    expect(provider.triggerCharacters).toEqual(["#"]);
  });

  test("replaces the token with the skill name and a space", async () => {
    const item = (await suggest("look at /ji"))?.items[0];
    if (!item) throw new Error("no item");

    expect(provider.applyCompletion(["look at /ji"], 0, 11, item, "/ji")).toEqual({
      lines: ["look at /jira "],
      cursorLine: 0,
      cursorCol: 14,
    });
    expect(provider.applyCompletion(["at /ji now"], 0, 6, item, "/ji").lines).toEqual([
      "at /jira now",
    ]);
    expect(provider.applyCompletion(["x"], 0, 1, BASE_ITEM, "x").lines).toEqual(["x", "base"]);
  });
});
