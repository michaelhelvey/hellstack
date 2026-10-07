import { expect, test } from "bun:test";

import { buildMermaidModule } from "../../src/mermaid/build.ts";

test("buildMermaidModule makes one module that imports nothing", async () => {
  const text = new TextDecoder().decode(await buildMermaidModule());
  expect(text).not.toMatch(/^\s*import\s/m);
  expect(text).toMatch(/export\s*\{\s*register\s*\}/);
});
