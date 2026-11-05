import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { factoryHome, inboxPath, ledgerPaths } from "../../src/core/paths.ts";

test("factoryHome makes a relative FACTORY_HOME absolute", () => {
  expect(factoryHome({ FACTORY_HOME: ".factory-dev" })).toBe(resolve(".factory-dev"));
});

test("event ids cannot leave the inbox folder", () => {
  const paths = ledgerPaths("/home/me/.factory");
  expect(inboxPath(paths, "gh-1.2")).toBe("/home/me/.factory/inbox/gh-1.2.json");
  expect(() => inboxPath(paths, "../config")).toThrow("not a valid event id");
  expect(() => inboxPath(paths, "..")).toThrow("not a valid event id");
});
