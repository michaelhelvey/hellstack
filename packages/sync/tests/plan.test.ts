import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { planEntries } from "../src/plan.ts";
import { resolveRoots } from "../src/roots.ts";

let repo: string;
const roots = resolveRoots("/home/me", {});

const files: Record<string, string> = {
  "packages/global/AGENTS.md": "# agents\n",
  "packages/claude-code/config/settings.json": "{}\n",
  "packages/opencode/config/opencode.jsonc": "{}\n",
  "packages/opencode/config/plugins/tool.ts": "export {};\n",
  "packages/pi/agent/settings.json": '{ "theme": "nightowl" }\n',
  "packages/skills/skills/demo/SKILL.md": "# demo\n",
  "packages/skills/skills/demo/node_modules/dep/index.js": "\n",
  "packages/skills/skills/.DS_Store": "\n",
};

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "hellstack-plan-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), text);
  }
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

test("planEntries maps each repository file to each harness", async () => {
  const entries = await planEntries(repo, roots);
  expect(entries.map((entry) => `${entry.kind} ${entry.target}`).sort()).toEqual([
    "dir /home/me/.claude/skills/demo",
    "dir /home/me/.pi/agent/skills/demo",
    "file /home/me/.claude/CLAUDE.md",
    "file /home/me/.claude/settings.json",
    "file /home/me/.config/opencode/AGENTS.md",
    "file /home/me/.config/opencode/opencode.jsonc",
    "file /home/me/.config/opencode/plugins/tool.ts",
    "file /home/me/.pi/agent/AGENTS.md",
    "file /home/me/.pi/agent/settings.json",
  ]);
});

test("planEntries adds the pi package to the pi settings", async () => {
  const entries = await planEntries(repo, roots);
  const settings = entries.find((entry) => entry.target === "/home/me/.pi/agent/settings.json");
  if (settings?.kind !== "file") throw new Error("pi settings entry is missing");
  expect(JSON.parse(new TextDecoder().decode(settings.file.content))).toEqual({
    theme: "nightowl",
    packages: [join(repo, "packages", "pi")],
  });
});
