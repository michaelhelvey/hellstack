import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { z } from "zod";

import { parseLock, skillDirs } from "../src/lock.ts";

const packageDir = join(import.meta.dir, "..");
const skillsDir = join(packageDir, "skills");
const thirdParty = new Set(
  skillDirs(parseLock(readFileSync(join(packageDir, "skills-lock.json"), "utf8"))),
);
const skills = readdirSync(skillsDir).filter((name) => !thirdParty.has(name));

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
