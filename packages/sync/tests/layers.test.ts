import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { layersPath, parseLayerList, readLayers } from "../src/layers.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hellstack-layers-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("parseLayerList splits the names and ignores empty names", () => {
  expect([...parseLayerList(" t4, ,herdr ")]).toEqual(["t4", "herdr"]);
  expect([...parseLayerList("")]).toEqual([]);
});

test("readLayers reads the layers file", async () => {
  await writeFile(layersPath(dir), '{ "layers": ["t4"] }');
  expect([...(await readLayers(layersPath(dir)))]).toEqual(["t4"]);
});

test("readLayers rejects a missing layers file", async () => {
  const error = await readLayers(join(dir, "missing.json")).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("does not exist");
});

test("readLayers rejects a layers file with the wrong shape", async () => {
  await writeFile(layersPath(dir), '["t4"]');
  const error = await readLayers(layersPath(dir)).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
});
