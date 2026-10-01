import { expect, test } from "bun:test";
import { parse } from "jsonc-parser";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { opencodeConfig, t4Plugins } from "../hellstack.sync.ts";

const base = await readFile(join(import.meta.dir, "..", "config", "opencode.jsonc"), "utf8");
const baseConfig = parse(base) as { plugins: string[] };

test("opencodeConfig does not change the config without the t4 layer", () => {
  expect(opencodeConfig(base, new Set())).toBe(base);
});

test("opencodeConfig adds the t4 plugins with the t4 layer", () => {
  expect(parse(opencodeConfig(base, new Set(["t4"])))).toEqual({
    ...baseConfig,
    plugins: [...baseConfig.plugins, ...t4Plugins],
  });
});
