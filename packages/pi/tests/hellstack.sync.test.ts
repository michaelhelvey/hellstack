import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { piSettings, t4Packages } from "../hellstack.sync.ts";

const base = await readFile(join(import.meta.dir, "..", "agent", "settings.json"), "utf8");
const baseSettings = JSON.parse(base) as { packages: string[] };
const packageDir = "/repo/packages/pi";

test("piSettings adds only this package without the t4 layer", () => {
  expect(JSON.parse(piSettings(base, { layers: new Set(), packageDir }))).toEqual({
    ...baseSettings,
    packages: [...baseSettings.packages, packageDir],
  });
});

test("piSettings adds the t4 packages with the t4 layer", () => {
  expect(JSON.parse(piSettings(base, { layers: new Set(["t4"]), packageDir }))).toEqual({
    ...baseSettings,
    packages: [...baseSettings.packages, ...t4Packages, packageDir],
  });
});

test("piSettings keeps the model settings of the current file", () => {
  const models = {
    defaultProvider: "claude-bridge",
    defaultModel: "claude-opus-5-5",
    defaultThinkingLevel: "high",
    enabledModels: ["t4/gpt-5.6-sol"],
  };
  const current = JSON.stringify({ theme: "dark", packages: ["npm:old"], ...models });
  expect(JSON.parse(piSettings(base, { layers: new Set(), packageDir, current }))).toEqual({
    ...baseSettings,
    packages: [...baseSettings.packages, packageDir],
    ...models,
  });
});

test("piSettings ignores a current file that is not valid JSON", () => {
  expect(
    JSON.parse(piSettings(base, { layers: new Set(), packageDir, current: "{ not json" })),
  ).toEqual({ ...baseSettings, packages: [...baseSettings.packages, packageDir] });
});
