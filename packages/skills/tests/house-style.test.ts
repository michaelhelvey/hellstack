import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { z } from "zod";

import { parseLock, skillDirs } from "../src/lock.ts";
import { packageDir, readUpstream, track, untracked } from "../src/upstream.ts";

const skillsDir = join(packageDir, "skills");
const upstream = await readUpstream();
const thirdParty = new Set(
  skillDirs(parseLock(readFileSync(join(packageDir, "skills-lock.json"), "utf8"))),
);
const skills = readdirSync(skillsDir).filter((name) => !thirdParty.has(name));
const upstreamSkills = Object.keys(upstream.skills);

/** Words from Cursor and Claude Code that the house style replaces. See the update-pstack skill. */
const forbidden: RegExp[] = [
  /\bCursor\b/,
  /\.cursor\//,
  /\.mdc\b/,
  /cursor-team-kit/,
  /\bgrok-\d/,
  /\bclaude-(opus|sonnet|haiku|fable)-\d/,
  /AskQuestion|AskUserQuestion/,
  /`Task`|\bTask (call|tool|subagent)/,
  /subagent_type|generalPurpose|run_in_background|is_background|readonly: (true|false)/,
  /setup-pstack|pstack-models|no-comments|comment-sicko|poteto-help|create-skill/,
  /\/loop\b/,
  /bugbot/i,
  /Claude Code|~\/\.claude\b|CLAUDE\.md/,
];

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".md") && !path.includes("node_modules"))
    .map((path) => join(dir, path));
}

function frontmatter(skill: string): unknown {
  const text = readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match ? Bun.YAML.parse(match[1]!) : undefined;
}

function brokenLinks(file: string): string[] {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  const targets = [...text.matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)].map((match) => match[1]!);
  return targets
    .filter((target) => !/^[a-z]+:/.test(target))
    .filter((target) => !existsSync(join(dirname(file), decodeURIComponent(target))));
}

describe("every skill", () => {
  test.each(skills)("%s has a name that is its directory name", (skill) => {
    const schema = z.object({ name: z.literal(skill), description: z.string().min(1) });
    expect(schema.safeParse(frontmatter(skill)).success).toBe(true);
  });

  test.each(skills)("%s has no broken relative links", (skill) => {
    const broken = markdownFiles(join(skillsDir, skill)).flatMap((file) =>
      brokenLinks(file).map((target) => `${relative(skillsDir, file)} -> ${target}`),
    );
    expect(broken).toEqual([]);
  });
});

describe("every upstream skill", () => {
  test.each(upstreamSkills)("%s exists", (skill) => {
    expect(existsSync(join(skillsDir, skill, "SKILL.md"))).toBe(true);
  });

  test.each(upstreamSkills)("%s uses the house style", (skill) => {
    const found = markdownFiles(join(skillsDir, skill)).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          forbidden.some((pattern) => pattern.test(line))
            ? [`${relative(skillsDir, file)}:${index + 1}: ${line.trim().slice(0, 120)}`]
            : [],
        ),
    );
    expect(found).toEqual([]);
  });
});

test("track adds paths to a skill and keeps the paths that it tracks", () => {
  const data = { ...upstream, skills: { a: ["x/a"] } };
  expect(track(data, "a", ["x/LICENSE", "x/a"]).skills).toEqual({ a: ["x/a", "x/LICENSE"] });
  expect(track(data, "b", ["x/b"]).skills).toEqual({ a: ["x/a"], b: ["x/b"] });
});

test("untracked returns the watched paths that no skill tracks and that are not skipped", () => {
  const data = { ...upstream, skills: { a: ["x/skills/a"] }, skipped: ["x/skills/b"] };
  const listed = ["x/skills/a", "x/skills/a/SKILL.md", "x/skills/b", "x/skills/c"];
  expect(untracked(data, listed)).toEqual(["x/skills/c"]);
});
