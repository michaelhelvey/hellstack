import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { piSettings, t4Models, t4Packages } from "../hellstack.sync.ts";

const base = await readFile(join(import.meta.dir, "..", "agent", "settings.json"), "utf8");
const baseSettings = JSON.parse(base) as { packages: string[]; enabledModels: string[] };

test("piSettings adds only this package without the t4 layer", () => {
  expect(JSON.parse(piSettings(base, new Set(), "/repo/packages/pi"))).toEqual({
    ...baseSettings,
    packages: [...baseSettings.packages, "/repo/packages/pi"],
  });
});

test("piSettings adds the t4 packages and replaces the models with the t4 layer", () => {
  expect(JSON.parse(piSettings(base, new Set(["t4"]), "/repo/packages/pi"))).toEqual({
    ...baseSettings,
    packages: [...baseSettings.packages, ...t4Packages, "/repo/packages/pi"],
    enabledModels: t4Models,
  });
});
