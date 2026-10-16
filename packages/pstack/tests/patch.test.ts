import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  type PatchSet,
  patchTree,
  removeLine,
  replaceOnce,
  replaceSection,
  type Tree,
  upstreamHash,
} from "../src/patch.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hellstack-pstack-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}

function texts(tree: Tree): Record<string, string> {
  return Object.fromEntries([...tree].map(([path, file]) => [path, decoder.decode(file.content)]));
}

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error("expected the promise to reject");
  return error.message;
}

function patchSet(changes: Partial<PatchSet>): PatchSet {
  return {
    include: ["a.md", "b.md"],
    drop: [],
    overrides: {},
    edits: {},
    forbidden: [],
    ...changes,
  };
}

describe("edits", () => {
  test("replaceOnce replaces the one match", () => {
    expect(replaceOnce("b", "$&x")("abc")).toBe("a$&xc");
  });

  test("replaceOnce throws when the text has no match or two matches", () => {
    expect(() => replaceOnce("z", "y")("abc")).toThrow("found 0");
    expect(() => replaceOnce("a", "y")("aa")).toThrow("found 2");
  });

  test("removeLine removes the line that contains the text", () => {
    expect(removeLine("two")("one\ntwo 2\nthree\n")).toBe("one\nthree\n");
    expect(() => removeLine("o")("one\ntwo\n")).toThrow("found 2");
  });

  test("replaceSection replaces the body up to the next heading of the same level", () => {
    const text = "# A\n\n## B\n\nold\n\n### C\n\nold\n\n## D\n\nkeep\n";
    expect(replaceSection("## B", "new")(text)).toBe("# A\n\n## B\n\nnew\n\n## D\n\nkeep\n");
  });

  test("replaceSection replaces the body to the end of the file for the last section", () => {
    expect(replaceSection("## B", "new")("## A\n\nkeep\n\n## B\n\nold\n")).toBe(
      "## A\n\nkeep\n\n## B\n\nnew\n\n",
    );
  });
});

describe("patchTree", () => {
  test("copies the included files without the dropped files, and applies the edits", async () => {
    const upstream = join(root, "upstream");
    await writeFiles(upstream, { "a/one.md": "one", "a/two.md": "two", "b/three.md": "three" });
    const set = patchSet({
      include: ["a"],
      drop: ["a/two.md"],
      edits: { "a/one.md": [replaceOnce("one", "uno")] },
    });
    expect(texts(await patchTree(upstream, set, join(root, "overrides")))).toEqual({
      "a/one.md": "uno",
    });
  });

  test("replaces a file with its override when the upstream hash matches", async () => {
    const upstream = join(root, "upstream");
    const overrides = join(root, "overrides");
    await writeFiles(upstream, { "a.md": "upstream" });
    await writeFiles(overrides, { "a.md": "override", "new.md": "new" });
    const hash = upstreamHash(encoder.encode("upstream"));
    const set = patchSet({
      overrides: { "a.md": { upstream: hash }, "new.md": { upstream: null } },
    });
    expect(texts(await patchTree(upstream, set, overrides))).toEqual({
      "a.md": "override",
      "new.md": "new",
    });
  });

  test("throws with the new hash when the upstream file of an override changed", async () => {
    const upstream = join(root, "upstream");
    await writeFiles(upstream, { "a.md": "changed" });
    await writeFiles(join(root, "overrides"), { "a.md": "override" });
    const set = patchSet({ overrides: { "a.md": { upstream: "0000000000000000" } } });
    const hash = upstreamHash(encoder.encode("changed"));
    expect(await failure(patchTree(upstream, set, join(root, "overrides")))).toContain(
      `set upstream to "${hash}"`,
    );
  });

  test("throws with the path when an edit does not apply", async () => {
    const upstream = join(root, "upstream");
    await writeFiles(upstream, { "a.md": "text" });
    const set = patchSet({ edits: { "a.md": [replaceOnce("gone", "x")] } });
    expect(await failure(patchTree(upstream, set, root))).toContain("a.md: expected 1 match");
  });

  test("throws when an edit names a file that is not in the tree", async () => {
    const upstream = join(root, "upstream");
    await writeFiles(upstream, { "a.md": "text" });
    const set = patchSet({ drop: ["a.md"], edits: { "a.md": [replaceOnce("text", "x")] } });
    expect(await failure(patchTree(upstream, set, root))).toContain(
      "a.md: there is no file to edit",
    );
  });

  test("throws with each file that has forbidden text", async () => {
    const upstream = join(root, "upstream");
    await writeFiles(upstream, { "a.md": "run /no-comments", "b.md": "fine" });
    const set = patchSet({ forbidden: [/no-comments/] });
    expect(await failure(patchTree(upstream, set, root))).toContain(
      "forbidden text:\na.md: no-comments",
    );
  });
});
