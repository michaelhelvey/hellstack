import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layerDir, type Roots } from "@hellstack/sync";

import manifest, { skillSources } from "../hellstack.sync.ts";

const packageDir = join(import.meta.dir, "..");
let home: string;
let roots: Roots;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "hellstack-skills-"));
  roots = {
    home,
    claude: join(home, ".claude"),
    opencode: join(home, ".config", "opencode"),
    pi: join(home, ".pi", "agent"),
    state: join(home, ".local", "state", "hellstack"),
    config: join(home, ".config", "hellstack"),
  };
  await mkdir(join(layerDir(roots.config, "work"), "skills", "work-only"), { recursive: true });
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

test("skillSources adds the skills directory of each layer that has one", async () => {
  expect(await skillSources(packageDir, roots, new Set(["work", "empty"]))).toEqual([
    join(packageDir, "skills"),
    join(layerDir(roots.config, "work"), "skills"),
  ]);
});

test("the manifest copies layer skills only when the layer is on", async () => {
  const target = join(roots.claude, "skills", "work-only");
  const on = await manifest.plan({ packageDir, roots, layers: new Set(["work"]) });
  const off = await manifest.plan({ packageDir, roots, layers: new Set() });
  expect(on.entries.map((entry) => entry.target)).toContain(target);
  expect(off.entries.map((entry) => entry.target)).not.toContain(target);
});
