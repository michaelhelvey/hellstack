import { readFile } from "node:fs/promises";

import { parseFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

const UsesSchema = z
  .object({ metadata: z.object({ uses: z.array(z.string()) }) })
  .transform((frontmatter) => frontmatter.metadata.uses)
  .catch([]);

/** Reads `metadata.uses` from the frontmatter of a skill. Returns an empty list if it is not set. */
export async function readUses(skill: Skill): Promise<string[]> {
  const text = await readFile(skill.filePath, "utf8").catch(() => "");

  return UsesSchema.parse(parseFrontmatter(text).frontmatter);
}

/**
 * Finds the skills that the start skills use, directly or through other skills. Returns the names
 * of the start skills and of the skills that they use. Names that are not in `skills` are ignored.
 */
export async function resolveUses(start: string[], skills: Skill[]): Promise<Set<string>> {
  const found = new Set<string>();
  let next = skills.filter((skill) => start.includes(skill.name));

  while (next.length > 0) {
    for (const skill of next) found.add(skill.name);
    const uses = new Set((await Promise.all(next.map(readUses))).flat());
    next = skills.filter((skill) => uses.has(skill.name) && !found.has(skill.name));
  }

  return found;
}
