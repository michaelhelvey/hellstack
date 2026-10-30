import { expect, test } from "bun:test";

import { disabledSkills, setSkillsEnabled, skillGroups } from "../src/groups.ts";

const source = "/repo/packages/skills";

test("skillGroups puts all upstream skills in pstack and groups skills.sh skills by source", () => {
  const upstream = {
    repo: "",
    commit: "",
    watch: [],
    skipped: [],
    skills: {
      architect: ["pstack/skills/architect", "pstack/LICENSE"],
      how: ["pstack/skills/how", "pstack/LICENSE"],
      thermos: ["thermos/skills/thermos"],
    },
  };
  const lock = {
    skills: {
      herdr: {
        source: "herdrdev/herdr",
        sourceType: "github",
        skillPath: "skills/herdr-cli/SKILL.md",
      },
    },
  };
  expect(Object.fromEntries(skillGroups(upstream, lock))).toEqual({
    pstack: ["architect", "how", "thermos"],
    "herdrdev/herdr": ["herdr-cli"],
  });
});

test("setSkillsEnabled turns skills off and on and keeps the other filters", () => {
  const settings = {
    theme: "system",
    packages: ["npm:other", { source, skills: ["!skills/jira"] }],
  };
  const off = setSkillsEnabled(settings, source, ["architect", "how"], false);
  expect(off).toEqual({
    theme: "system",
    packages: [
      "npm:other",
      { source, skills: ["!skills/jira", "-skills/architect", "-skills/how"] },
    ],
  });
  expect(disabledSkills(off, source)).toEqual(["architect", "how"]);
  expect(setSkillsEnabled(off, source, ["architect", "how"], true)).toEqual(settings);
});

test("setSkillsEnabled changes a string entry and does not leave an empty filter", () => {
  const settings = { packages: [source] };
  const off = setSkillsEnabled(settings, source, ["how"], false);
  expect(off).toEqual({ packages: [{ source, skills: ["-skills/how"] }] });
  expect(setSkillsEnabled(off, source, ["how"], true)).toEqual(settings);
});

test("setSkillsEnabled does not add a filter two times", () => {
  const once = setSkillsEnabled({ packages: [source] }, source, ["how"], false);
  expect(setSkillsEnabled(once, source, ["how"], false)).toEqual(once);
});

test("setSkillsEnabled fails when pi does not load the package", () => {
  expect(() => setSkillsEnabled({ packages: [] }, source, ["how"], false)).toThrow("bun run sync");
});
