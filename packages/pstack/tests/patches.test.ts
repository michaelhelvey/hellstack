import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { z } from "zod";

import { buildPstack, vendorPath } from "../src/index.ts";

const packageDir = join(import.meta.dir, "..");
const pluginDir = join(packageDir, vendorPath, "plugins", "pstack");
const tree = await buildPstack(packageDir);
const decoder = new TextDecoder();

function text(path: string): string {
  const file = tree.get(path);
  if (file === undefined) throw new Error(`${path} is not in the package`);
  return decoder.decode(file.content);
}

const manifest = z.object({
  pi: z.object({ skills: z.array(z.string()), extensions: z.array(z.string()) }),
});

test("the package.json names only paths that are in the package", () => {
  const { pi } = manifest.parse(JSON.parse(text("package.json")));
  const paths = [...pi.skills, ...pi.extensions].map((path) => normalize(path));
  expect(paths.filter(inTree)).toEqual(paths);
});

test("the extension imports at run time only modules that are in the package", () => {
  const extension = [...tree.keys()].filter((path) => path.startsWith("pi/"));
  const imports = extension.flatMap((path) =>
    [...text(path).matchAll(/^import (?!type )[^;]*from "(\.\/[^"]+)"/gm)].map((match) =>
      join(dirname(path), match[1]!),
    ),
  );
  expect(imports.filter((path) => !tree.has(path))).toEqual([]);
});

test("the package does not have the pstack agent runner", () => {
  expect(tree.has("pi/agents.ts")).toBe(false);
  expect(text("pi/index.ts")).not.toContain("AgentRunner");
});

function relativeLinks(path: string): string[] {
  const links = [...text(path).matchAll(/\]\((\.{1,2}\/[^)#\s]+)/g)];
  return links.map((match) => normalize(join(dirname(path), match[1]!)));
}

function inTree(path: string): boolean {
  return tree.has(path) || [...tree.keys()].some((key) => key.startsWith(`${path}/`));
}

test("the patches do not break a Markdown link that works upstream", () => {
  const markdown = [...tree.keys()].filter((path) => path.endsWith(".md"));
  const broken = markdown
    .flatMap(relativeLinks)
    .filter((link) => !inTree(link) && existsSync(join(pluginDir, link)));
  expect(broken).toEqual([]);
});
