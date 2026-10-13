import { stat } from "node:fs/promises";
import { join } from "node:path";
import { defineSync, type Layers, layerDir, type Roots, skillEntries } from "@hellstack/sync";

async function isDir(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/**
 * Returns the skill source directories: `skills/` in this package, then `skills/` in the private
 * directory of each layer that has one (for example `~/.config/hellstack/layers/t4/skills`).
 */
export async function skillSources(
  packageDir: string,
  roots: Roots,
  layers: Layers,
): Promise<string[]> {
  const layerSkills = [...layers].map((layer) => join(layerDir(roots.config, layer), "skills"));
  const found = await Promise.all(layerSkills.map(isDir));
  return [join(packageDir, "skills"), ...layerSkills.filter((_, index) => found[index])];
}

/**
 * Copies each skill to the skill directories. Claude Code and opencode read skills from
 * `~/.claude/skills`, and pi reads them from `~/.pi/agent/skills`. The sync stops when a layer skill
 * has the same name as a skill in this package.
 */
export default defineSync(async ({ packageDir, roots, layers }) => {
  const targets = [join(roots.claude, "skills"), join(roots.pi, "skills")];
  const sources = await skillSources(packageDir, roots, layers);
  const entries = await Promise.all(sources.map((source) => skillEntries(source, targets)));
  return { entries: entries.flat() };
});
