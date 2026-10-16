import { expect, test } from "bun:test";
import { dirname, join, normalize } from "node:path";
import type { Tree } from "@hellstack/pstack";

import { chinchillaModes, instructionFiles } from "../plugin/hellstack/index.ts";
import { buildPluginsRepo, buildSkillsRepo, pluginName, skillOf, sourcesIn } from "../src/build.ts";

const sources = sourcesIn(join(import.meta.dir, "..", ".."));
const skills = await buildSkillsRepo(sources);
const plugins = await buildPluginsRepo(sources);
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

function text(tree: Tree, path: string): string {
  const file = tree.get(path);
  if (file === undefined) throw new Error(`${path} is not in the tree`);
  return strictDecoder.decode(file.content);
}

function filesBySkill(): Map<string, string[]> {
  const bySkill = new Map<string, string[]>();
  for (const path of skills.keys())
    bySkill.set(skillOf(path), [...(bySkill.get(skillOf(path)) ?? []), path]);
  return bySkill;
}

test("each skill is a top-level directory whose SKILL.md name is the directory name", () => {
  const names = [...filesBySkill().keys()];
  const wrong = names.filter(
    (name) => /^name: (\S+)$/m.exec(text(skills, `${name}/SKILL.md`))?.[1] !== name,
  );
  expect(wrong).toEqual([]);
  expect([...skills.keys()].filter((path) => !path.includes("/"))).toEqual([]);
});

test("the skills repository is in the limits of an Amp-hosted repository", () => {
  const bySkill = filesBySkill();
  const size = [...skills.values()].reduce((sum, file) => sum + file.content.length, 0);
  expect(bySkill.size).toBeLessThanOrEqual(200);
  expect([...bySkill].filter(([, files]) => files.length > 200)).toEqual([]);
  expect(size).toBeLessThan(25 * 1024 * 1024);
});

test("every file in the skills repository is UTF-8 text", () => {
  const binary = [...skills.keys()].filter((path) => {
    try {
      return text(skills, path).includes("\0");
    } catch {
      return true;
    }
  });
  expect(binary).toEqual([]);
});

test("every relative Markdown link in the skills repository points into the repository", () => {
  const keys = [...skills.keys()];
  const broken = keys
    .filter((path) => path.endsWith(".md"))
    .flatMap((path) =>
      [...text(skills, path).matchAll(/\]\((\.{1,2}\/[^)#\s]+)/g)].map((match) =>
        normalize(join(dirname(path), match[1]!)),
      ),
    )
    .filter((link) => !skills.has(link) && !keys.some((key) => key.startsWith(`${link}/`)));
  expect(broken).toEqual([]);
});

test("the plugin has an @amp-agent-mode directive for each mode, and no other", () => {
  const directives = [
    ...text(plugins, `${pluginName}/index.ts`).matchAll(/^\/\/ @amp-agent-mode (.+)$/gm),
  ];
  const modes = directives.map((match) => JSON.parse(match[1]!) as unknown);
  expect(modes).toEqual(chinchillaModes.map((mode) => ({ key: mode.key, label: mode.key })));
});

test("the plugin has its instruction files", () => {
  expect(instructionFiles.filter((name) => !plugins.has(`${pluginName}/${name}`))).toEqual([]);
});

test("the pstack model table names only chinchilla modes, and each of them", () => {
  const table = text(plugins, `${pluginName}/pstack.md`);
  const named = new Set([...table.matchAll(/`(chinchilla-[a-z]+)`/g)].map((match) => match[1]));
  expect([...named].sort()).toEqual(chinchillaModes.map((mode) => mode.key).sort());
});
