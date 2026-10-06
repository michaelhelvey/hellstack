import { expect, test } from "bun:test";

import { groupBySource, parseLock, skillDirs, type SkillsLock } from "../src/lock.ts";

const lock: SkillsLock = {
  skills: {
    herdr: { source: "herdrdev/herdr", sourceType: "github" },
    triage: { source: "herdrdev/herdr", sourceType: "github" },
    pinned: { source: "acme/skills", sourceType: "github", ref: "v2" },
    internal: {
      source: "acme/internal",
      sourceType: "git",
      sourceUrl: "git@git.acme.dev:acme/internal.git",
    },
    vendored: { source: "some-package", sourceType: "node_modules" },
  },
};

test("groupBySource fetches each source one time", () => {
  expect(groupBySource(lock)).toEqual([
    { source: "herdrdev/herdr", skills: ["herdr", "triage"] },
    { source: "acme/skills#v2", skills: ["pinned"] },
    { source: "git@git.acme.dev:acme/internal.git", skills: ["internal"] },
  ]);
});

test("groupBySource includes only the named skills", () => {
  expect(groupBySource(lock, ["triage", "pinned"])).toEqual([
    { source: "herdrdev/herdr", skills: ["triage"] },
    { source: "acme/skills#v2", skills: ["pinned"] },
  ]);
});

test("groupBySource rejects names that are not in the lock", () => {
  expect(() => groupBySource(lock, ["herdr", "missing"])).toThrow("missing");
});

test("parseLock reads a lock file that the skills CLI wrote", () => {
  const text = JSON.stringify({
    version: 1,
    skills: {
      herdr: {
        source: "herdrdev/herdr",
        sourceType: "github",
        skillPath: "skills/herdr/SKILL.md",
        computedHash: "66715d76",
      },
    },
  });
  expect(parseLock(text)).toEqual({
    skills: {
      herdr: {
        source: "herdrdev/herdr",
        sourceType: "github",
        skillPath: "skills/herdr/SKILL.md",
      },
    },
  });
});

test("parseLock rejects an entry without a source", () => {
  expect(() => parseLock('{"skills":{"herdr":{"sourceType":"github"}}}')).toThrow();
});

test("skillDirs uses the directory of the SKILL.md file, not the display name", () => {
  const text = JSON.stringify({
    skills: {
      "Poteto Mode": {
        source: "acme/skills",
        sourceType: "github",
        skillPath: "skills/poteto-mode/SKILL.md",
      },
      "sentry-cli": { source: "cli.sentry.dev", sourceType: "well-known" },
    },
  });
  expect(skillDirs(parseLock(text))).toEqual(["poteto-mode", "sentry-cli"]);
});
