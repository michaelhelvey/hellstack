import { afterEach, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { main } from "../src/cli.ts";
import { tempFolder } from "./core/helpers.ts";

const saved = process.env.FACTORY_HOME;

afterEach(() => {
  if (saved === undefined) delete process.env.FACTORY_HOME;
  else process.env.FACTORY_HOME = saved;
});

test("init makes the ledger in FACTORY_HOME", async () => {
  const home = await tempFolder();
  process.env.FACTORY_HOME = home;
  expect(await main(["init"])).toBe(0);
  expect(await main(["init"])).toBe(0);
  expect((await readdir(home)).sort()).toEqual([
    "COORDINATOR.md",
    "config.json",
    "inbox",
    "state",
    "tasks",
  ]);
});

test("an unknown command exits with 2", async () => {
  expect(await main(["nope"])).toBe(2);
  expect(await main([])).toBe(2);
});
