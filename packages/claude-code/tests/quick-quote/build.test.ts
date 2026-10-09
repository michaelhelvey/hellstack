import { expect, test } from "bun:test";

import { buildQuickQuoteModule } from "../../src/quick-quote/build.ts";

test("buildQuickQuoteModule makes one module that imports nothing", async () => {
  const text = new TextDecoder().decode(await buildQuickQuoteModule());
  expect(text).not.toMatch(/^\s*import\s/m);
  expect(text).toMatch(/export\s*\{\s*register\s*\}/);
});
