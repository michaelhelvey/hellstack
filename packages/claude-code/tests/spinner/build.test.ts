import { expect, test } from "bun:test";

import { buildSpinnerModule } from "../../src/spinner/build.ts";

test("buildSpinnerModule makes one module that imports nothing", async () => {
  const text = new TextDecoder().decode(await buildSpinnerModule());
  expect(text).not.toMatch(/^\s*import\s/m);
  expect(text).toMatch(/export\s*\{[^}]*\bregister\b[^}]*\}/);
});
