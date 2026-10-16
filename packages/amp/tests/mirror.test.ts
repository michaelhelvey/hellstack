import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tree } from "../src/build.ts";
import { managedFileName, mirror } from "../src/mirror.ts";

const encoder = new TextEncoder();
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hellstack-amp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): Tree {
  return new Map(
    Object.entries(files).map(([path, text]) => [
      path,
      { content: encoder.encode(text), mode: 0o644 },
    ]),
  );
}

test("a mirror removes the files that it wrote before and keeps the files that it did not write", async () => {
  await writeFile(join(dir, "user-file.md"), "mine");
  await mirror(dir, tree({ "a/SKILL.md": "a", "b/SKILL.md": "b" }));
  await mirror(dir, tree({ "a/SKILL.md": "a2" }));
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const paths = files
    .filter((file) => file.isFile())
    .map((file) => join(file.parentPath, file.name));
  expect(paths.map((path) => path.slice(dir.length + 1)).sort()).toEqual(
    [managedFileName, "a/SKILL.md", "user-file.md"].sort(),
  );
  expect(await readFile(join(dir, "a/SKILL.md"), "utf8")).toBe("a2");
});
