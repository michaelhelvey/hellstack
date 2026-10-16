import { expect, test } from "bun:test";

import { mergeSettings, REPO_PACKAGES } from "../../scripts/install.ts";

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
