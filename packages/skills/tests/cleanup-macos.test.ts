import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findArtifacts } from "../skills/cleanup-macos/scripts/lib/artifacts.ts";
import { CACHE_ROOTS, isCacheDirectory } from "../skills/cleanup-macos/scripts/lib/caches.ts";
import { exists } from "../skills/cleanup-macos/scripts/lib/fs.ts";
import { resolveTargets } from "../skills/cleanup-macos/scripts/lib/targets.ts";

const CLEAN = join(import.meta.dir, "..", "skills", "cleanup-macos", "scripts", "clean.ts");

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "cleanup-macos-test-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(...parts: string[]): Promise<string> {
  const path = join(root, ...parts);

  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "");

  return path;
}

async function refusal(args: string[], roots: string[]): Promise<string> {
  const error = await resolveTargets(args, [], roots).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(Error);

  return String(error);
}

async function dir(...parts: string[]): Promise<string> {
  const path = join(root, ...parts);

  await mkdir(path, { recursive: true });

  return path;
}

describe("findArtifacts", () => {
  test("finds only artifact directories next to their marker files", async () => {
    await touch("web", "package.json");
    await touch("web", "node_modules", "left-pad", "package.json");
    await touch("web", "node_modules", "dep", "node_modules", "x", "index.js");
    await touch("crate", "Cargo.toml");
    await touch("crate", "target", "debug", "app");
    await touch("java", "target", "classes", "App.class");
    await touch("orphan", "node_modules", "x", "index.js");
    await touch("py", "pkg", "__pycache__", "mod.pyc");
    await touch("repo", ".git", "package.json");
    await touch("repo", ".git", "node_modules", "x");

    const artifacts = await findArtifacts([root]);
    const found = artifacts.map((artifact) => [artifact.kind, artifact.path]).toSorted();

    expect(found).toEqual([
      ["node", join(root, "web", "node_modules")],
      ["python", join(root, "py", "pkg", "__pycache__")],
      ["rust", join(root, "crate", "target")],
    ]);
  });
});

describe("resolveTargets", () => {
  test("accepts artifacts in the roots and tool cache IDs", async () => {
    await touch("web", "package.json");

    const modules = await dir("web", "node_modules");
    const cache = {
      id: "npm",
      description: "",
      paths: [],
      size: () => Promise.resolve(0),
      clean: () => Promise.resolve(),
    };
    const targets = await resolveTargets([modules, "npm"], [cache], [root]);

    expect(targets.map((target) => target.label)).toEqual([modules, "npm"]);
  });

  test("refuses source code directories", async () => {
    await touch("web", "package.json");

    expect(await refusal([join(root, "web")], [root])).toContain(
      "not a cache directory or a project artifact",
    );
  });

  test("refuses artifacts without a marker file", async () => {
    const target = await dir("java", "target");

    expect(await refusal([target], [root])).toContain("not a cache directory");
  });

  test("refuses artifacts outside the roots", async () => {
    await touch("web", "package.json");

    const modules = await dir("web", "node_modules");

    expect(await refusal([modules], [join(root, "other")])).toContain("not a cache directory");
  });

  test("refuses relative paths", async () => {
    expect(await refusal(["node_modules"], [root])).toContain("absolute path");
  });
});

describe("isCacheDirectory", () => {
  test("accepts only the direct subdirectories of a cache root", () => {
    const cacheRoot = CACHE_ROOTS[0] ?? "";

    expect(isCacheDirectory(join(cacheRoot, "com.example.app"))).toBe(true);
    expect(isCacheDirectory(join(cacheRoot, "com.example.app", "data"))).toBe(false);
    expect(isCacheDirectory(cacheRoot)).toBe(false);
    expect(isCacheDirectory(join(cacheRoot, "..", "Preferences"))).toBe(false);
  });
});

describe("clean.ts", () => {
  test("removes the artifacts and keeps the source code", async () => {
    const source = await touch("web", "src", "index.ts");

    await touch("web", "package.json");
    await touch("web", "node_modules", "x", "index.js");

    const proc = Bun.spawn(["bun", CLEAN, "--root", root, join(root, "web", "node_modules")], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await proc.exited).toBe(0);
    expect(await exists(join(root, "web", "node_modules"))).toBe(false);
    expect(await exists(source)).toBe(true);
  });

  test("removes nothing when one target is not valid", async () => {
    await touch("web", "package.json");
    await touch("web", "node_modules", "x", "index.js");

    const proc = Bun.spawn(
      ["bun", CLEAN, "--root", root, join(root, "web", "node_modules"), join(root, "web")],
      { stdout: "pipe", stderr: "pipe" },
    );

    expect(await proc.exited).toBe(1);
    expect(await exists(join(root, "web", "node_modules"))).toBe(true);
  });
});
