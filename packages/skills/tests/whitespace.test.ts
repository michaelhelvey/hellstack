import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadDependencies } from "../skills/whitespace/scripts/lib/deps.ts";
import { fixWhitespace } from "../skills/whitespace/scripts/lib/oxlint.ts";

const deps = await loadDependencies();

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "whitespace-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSource(name: string, source: string): Promise<string> {
  const path = join(dir, name);

  await writeFile(path, source);

  return path;
}

test("adds blank lines in all files", async () => {
  const first = await writeSource(
    "first.ts",
    "export const a = 1;\n/** Attached to b. */\nexport const b = 2;\n",
  );
  const second = await writeSource(
    "second.ts",
    "export function f() {\nconst a = 1;\nconst b = 2;\nreturn a + b;\n}\n",
  );

  expect(await fixWhitespace(deps, [first, second])).toBe(0);
  expect(await readFile(first, "utf8")).toBe(
    "export const a = 1;\n\n/** Attached to b. */\nexport const b = 2;\n",
  );
  expect(await readFile(second, "utf8")).toBe(
    "export function f() {\nconst a = 1;\nconst b = 2;\n\nreturn a + b;\n}\n",
  );
});

test("does not change a file that is already correct", async () => {
  const source = "import { x } from 'x';\n\nexport const a = x;\n\nexport function f() {}\n";
  const path = await writeSource("clean.ts", source);

  expect(await fixWhitespace(deps, [path])).toBe(0);
  expect(await readFile(path, "utf8")).toBe(source);
});

test("keeps function overloads together", async () => {
  const path = await writeSource(
    "overloads.ts",
    "export function g(a: string): void;\nexport function g(a: number): void;\nexport function g(a: unknown) {}\nfoo();\n",
  );

  expect(await fixWhitespace(deps, [path])).toBe(0);
  expect(await readFile(path, "utf8")).toBe(
    "export function g(a: string): void;\nexport function g(a: number): void;\nexport function g(a: unknown) {}\n\nfoo();\n",
  );
});

test("does not run the default oxlint rules", async () => {
  const source = "export function f() {\n  debugger;\n}\n";
  const path = await writeSource("debugger.ts", source);

  expect(await fixWhitespace(deps, [path])).toBe(0);
  expect(await readFile(path, "utf8")).toBe(source);
});
