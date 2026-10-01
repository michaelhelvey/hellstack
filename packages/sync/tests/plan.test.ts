import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planRepo } from "../src/plan.ts";
import { resolveRoots } from "../src/roots.ts";

let repo: string;
const roots = resolveRoots("/home/me", {});

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "hellstack-plan-"));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function writeManifest(name: string, body: string): Promise<void> {
  await mkdir(join(repo, "packages", name), { recursive: true });
  await writeFile(join(repo, "packages", name, "hellstack.sync.ts"), body);
}

function manifest(target: string, integration: string): string {
  return `export default {
  plan: ({ packageDir, layers }) => ({
    entries: [{ kind: "dir", target: ${JSON.stringify(target)} + [...layers].join(), source: packageDir }],
    integrations: [{ name: ${JSON.stringify(integration)}, command: ["true"] }],
  }),
};\n`;
}

test("planRepo collects the plan of each package in name order", async () => {
  await writeManifest("b", manifest("/t/b", "second"));
  await writeManifest("a", manifest("/t/a", "first"));
  await mkdir(join(repo, "packages", "no-manifest"), { recursive: true });
  const plan = await planRepo(repo, roots, new Set(["t4"]));
  expect(plan.entries).toEqual([
    { kind: "dir", target: "/t/at4", source: join(repo, "packages", "a") },
    { kind: "dir", target: "/t/bt4", source: join(repo, "packages", "b") },
  ]);
  expect(plan.integrations.map((integration) => integration.name)).toEqual(["first", "second"]);
});

test("planRepo rejects two entries with the same target", async () => {
  await writeManifest("a", manifest("/t/same", "first"));
  await writeManifest("b", manifest("/t/same", "second"));
  const error = await planRepo(repo, roots, new Set()).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("two entries write to /t/same");
});

test("planRepo rejects a manifest without a plan function", async () => {
  await writeManifest("a", "export default { plan: 1 };\n");
  const error = await planRepo(repo, roots, new Set()).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("does not export a manifest");
});
