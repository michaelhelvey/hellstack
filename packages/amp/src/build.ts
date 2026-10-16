import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promptNames, promptPath } from "@hellstack/prompts";

import { instructionFiles } from "../plugin/hellstack/index.ts";

/** The content and the mode of one file. */
export interface FileData {
  content: Uint8Array;
  mode: number;
}

/** Files by their path in a repository. */
export type Tree = Map<string, FileData>;

/** The name of the plugin in the Amp personal plugins repository. */
export const pluginName = "hellstack";

/**
 * The skills that need the user's machine: a desktop app, a signed-in browser, or a terminal
 * multiplexer. Amp does not get them.
 */
export const localSkills = [
  "chrome-devtools-cli",
  "cleanup-macos",
  "herdr",
  "hunk-review",
  "one-on-one-prep",
];

const packagesDir = join(import.meta.dir, "..", "..");

/** The directory of all the skills. */
export const skillsDir = join(packagesDir, "skills", "skills");

const ignored = /(^|\/)(node_modules|\.DS_Store)(\/|$)/;

async function readTree(dir: string, prefix: string): Promise<Tree> {
  const paths = await readdir(dir, { recursive: true });
  const tree: Tree = new Map();
  for (const path of paths.filter((path) => !ignored.test(path))) {
    const info = await stat(join(dir, path));
    if (info.isFile()) {
      tree.set(join(prefix, path), { content: await readFile(join(dir, path)), mode: info.mode });
    }
  }
  return tree;
}

/** Returns the top-level directory of a path, which is the skill name in a skills repository. */
export function skillOf(path: string): string {
  return path.split("/")[0]!;
}

/** Makes the tree of the Amp personal skills repository: every skill except `localSkills`. */
export async function buildSkillsRepo(): Promise<Tree> {
  const tree = await readTree(skillsDir, "");
  return new Map([...tree].filter(([path]) => !localSkills.includes(skillOf(path))));
}

/**
 * Makes the tree of the Amp personal plugins repository: the plugin, and the files of
 * `@hellstack/prompts` that the plugin reads.
 */
export async function buildPluginsRepo(): Promise<Tree> {
  const tree = await readTree(join(import.meta.dir, "..", "plugin", pluginName), pluginName);
  const shared = promptNames.filter((name) => instructionFiles.includes(`${name}.md`));
  for (const name of shared) {
    const content = await readFile(promptPath(name));
    tree.set(`${pluginName}/${name}.md`, { content, mode: 0o644 });
  }
  return tree;
}
