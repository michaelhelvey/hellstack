import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAmpPstack, type Tree } from "@hellstack/pstack";
import { type FileData, listFiles, readFileData } from "@hellstack/sync";

import { buildPersonalSkills } from "./skills.ts";

/** The directories of the other packages that the Amp build reads, from the `packages` directory. */
export interface Sources {
  pstack: string;
  skills: string;
  claudeCode: string;
  amp: string;
}

/** Returns the source directories of the Amp build in the `packages` directory. */
export function sourcesIn(packagesDir: string): Sources {
  return {
    pstack: join(packagesDir, "pstack"),
    skills: join(packagesDir, "skills", "skills"),
    claudeCode: join(packagesDir, "claude-code"),
    amp: join(packagesDir, "amp"),
  };
}

/** The name of the plugin in the Amp personal plugins repository. */
export const pluginName = "hellstack";

const encoder = new TextEncoder();

/**
 * Makes the tree of the Amp personal skills repository: the patched pstack skills, then the
 * personal skills. It throws an error when two skills have the same name.
 */
export async function buildSkillsRepo(sources: Sources): Promise<Tree> {
  const [pstack, personal] = await Promise.all([
    buildAmpPstack(sources.pstack),
    buildPersonalSkills(sources.skills),
  ]);
  const pstackSkills = new Set([...pstack.keys()].map(skillOf));
  const both = [...new Set([...personal.keys()].map(skillOf))].filter((s) => pstackSkills.has(s));
  if (both.length > 0)
    throw new Error(`pstack and the personal skills both have: ${both.join(", ")}`);
  return new Map([...pstack, ...personal]);
}

/** Returns the top-level directory of a path, which is the skill name in a skills repository. */
export function skillOf(path: string): string {
  return path.split("/")[0]!;
}

function withoutFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n+/, "");
}

/**
 * Makes the tree of the Amp personal plugins repository. The plugin gets the chinchilla output style
 * of Claude Code without its frontmatter.
 */
export async function buildPluginsRepo(sources: Sources): Promise<Tree> {
  const pluginDir = join(sources.amp, "plugin", pluginName);
  const paths = await listFiles(pluginDir);
  const files = await Promise.all(paths.map((path) => readFileData(join(pluginDir, path))));
  const tree: Tree = new Map(paths.map((path, index) => [`${pluginName}/${path}`, files[index]!]));
  const style = join(sources.claudeCode, "config", "output-styles", "chinchilla.md");
  const chinchilla: FileData = {
    content: encoder.encode(withoutFrontmatter(await readFile(style, "utf8"))),
    mode: 0o644,
  };
  tree.set(`${pluginName}/chinchilla.md`, chinchilla);
  return tree;
}
