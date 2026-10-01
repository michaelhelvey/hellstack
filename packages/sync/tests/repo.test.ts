import { expect, test } from "bun:test";
import { join } from "node:path";

import { planRepo, type RepoPlan } from "../src/plan.ts";
import { resolveRoots } from "../src/roots.ts";

const repo = join(import.meta.dir, "..", "..", "..");
const roots = resolveRoots("/home/me", {});

function planText(plan: RepoPlan): string {
  const files = plan.entries.map((entry) =>
    entry.kind === "file" ? new TextDecoder().decode(entry.file.content) : entry.source,
  );
  return [...files, ...plan.integrations.map((integration) => integration.name)].join("\n");
}

test("the repository plan has no t4 config when the t4 layer is off", async () => {
  const text = planText(await planRepo(repo, roots, new Set()));
  expect(text).not.toContain("transport4");
  expect(text).not.toContain("t4/");
  expect(text).not.toContain("ai-gateway");
});

async function targets(layers: string[]): Promise<string[]> {
  const plan = await planRepo(repo, roots, new Set(layers));
  return plan.entries.map((entry) => entry.target);
}

test("the repository plan writes the same targets for each set of layers", async () => {
  expect(await targets(["t4"])).toEqual(await targets([]));
});
