import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AGENTS_FILE } from "@hellstack/prompts";

import { linkAgentsFile, mergeSettings, REPO_PACKAGES } from "../../scripts/install.ts";

const ours = { theme: "system", packages: ["npm:pi-fff"] };

test("mergeSettings adds our settings and packages, and keeps the settings of the machine", () => {
  const current = { defaultModel: "x", theme: "dark", packages: ["npm:work-plugin"] };
  expect(mergeSettings(current, ours, () => true)).toEqual({
    defaultModel: "x",
    theme: "system",
    packages: ["npm:work-plugin", "npm:pi-fff", ...REPO_PACKAGES],
  });
});

test("mergeSettings does not add a package twice, also when the machine filters it", () => {
  const filtered = { source: REPO_PACKAGES[0]!, extensions: ["-src/whimsical/index.ts"] };
  const current = { packages: [filtered, "npm:pi-fff"] };
  expect(mergeSettings(current, ours, () => true).packages).toEqual([
    filtered,
    "npm:pi-fff",
    REPO_PACKAGES[1],
  ]);
});

test("mergeSettings removes local packages that do not exist", () => {
  const current = { packages: ["/gone/vendor/pstack", "npm:a"] };
  expect(mergeSettings(current, ours, (path) => !path.startsWith("/gone")).packages).toEqual([
    "npm:a",
    "npm:pi-fff",
    ...REPO_PACKAGES,
  ]);
});

test("the global AGENTS.md of the repository exists", () => {
  expect(existsSync(AGENTS_FILE)).toBe(true);
});

/** Runs `run` in a temporary folder, with `agentDir` inside it. */
async function withTempRoot(run: (root: string, agentDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "hellstack-install-"));
  try {
    await run(root, path.join(root, "agent"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("linkAgentsFile links AGENTS.md in the agent folder to the repository file", async () => {
  await withTempRoot(async (_root, agentDir) => {
    await linkAgentsFile(agentDir);
    expect(await readlink(path.join(agentDir, "AGENTS.md"))).toBe(AGENTS_FILE);
  });
});

test("linkAgentsFile replaces an AGENTS.md that is a file", async () => {
  await withTempRoot(async (root, agentDir) => {
    const source = path.join(root, "source.md");
    await writeFile(source, "# other\n");
    await linkAgentsFile(agentDir, source);
    expect(await readFile(path.join(agentDir, "AGENTS.md"), "utf8")).toEqual("# other\n");

    const link = path.join(agentDir, "AGENTS.md");
    await rm(link);
    await writeFile(link, "# stale\n");
    await linkAgentsFile(agentDir, source);
    expect(await readlink(link)).toBe(source);
  });
});

test("linkAgentsFile replaces a link to another file", async () => {
  await withTempRoot(async (root, agentDir) => {
    const link = path.join(agentDir, "AGENTS.md");
    await linkAgentsFile(agentDir, path.join(root, "first.md"));
    await rm(link);
    await symlink(path.join(root, "second.md"), link);

    await linkAgentsFile(agentDir, path.join(root, "first.md"));
    expect(await readlink(link)).toBe(path.join(root, "first.md"));
  });
});
