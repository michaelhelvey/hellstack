import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { skillsDir } from "../src/build.ts";

const sheet = readFileSync(
  join(import.meta.dir, "..", "plugin", "hellstack", "pstack-amp.md"),
  "utf8",
);

const upstreamSchema = z.object({ skills: z.record(z.string(), z.unknown()) });
const upstreamText = readFileSync(join(skillsDir, "..", "upstream.json"), "utf8");
const pstackSkills = Object.keys(upstreamSchema.parse(JSON.parse(upstreamText)).skills);

function rolesInSkills(): string[] {
  const files = readdirSync(skillsDir, { recursive: true, encoding: "utf8" });
  const text = files
    .filter((path) => path.endsWith(".md") && pstackSkills.includes(path.split("/")[0]!))
    .map((path) => readFileSync(join(skillsDir, path), "utf8"))
    .join("\n");
  const named = [...text.matchAll(/`([a-z][a-z ,-]+)` line/g)].map((match) => match[1]!);
  return [...new Set([...named, "strongest judgment", "judgment and prose", "reflect tooling"])];
}

test("the Amp pstack models sheet has every role that a skill names", () => {
  expect(rolesInSkills().filter((role) => !sheet.includes(role))).toEqual([]);
});
