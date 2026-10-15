import { expect, test } from "bun:test";

import { skillRefs } from "../../src/shared/skill-refs.ts";

test("finds /name and /skill:name tokens anywhere in the text, once each", () => {
  const text = "/skill:jira go, then (/review) and `/jira`.\nnext line /browser-use";

  expect(skillRefs(text)).toEqual(["jira", "review", "browser-use"]);
});

test("ignores paths, URLs, and slashes inside words", () => {
  const text = "see src/jira, /usr/bin, /etc/hosts, https://x.y/jira, a/b, and /file.txt";

  expect(skillRefs(text)).toEqual([]);
});

test("ignores the text of skill blocks", () => {
  const block = '<skill name="jira" location="/s/jira/SKILL.md">\nUse /browser.\n</skill>';

  expect(skillRefs(`${block}\n\nrun /jira now`)).toEqual(["jira"]);
});
