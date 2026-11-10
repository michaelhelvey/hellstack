import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Logger } from "effect";
import { HiddenStore } from "../src/hidden.ts";
import type { DashError } from "../src/item.ts";

const dirs: Array<string> = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const tempFile = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dash-hidden-"));
  dirs.push(dir);
  return path.join(dir, "nested", "state", "hidden.json");
};

const run = <A>(file: string, effect: Effect.Effect<A, DashError, HiddenStore>) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      HiddenStore.layerAt(file).pipe(
        Layer.provide(BunServices.layer),
        Layer.provideMerge(Logger.layer([])),
      ),
    ),
  );

const list = Effect.flatMap(Effect.service(HiddenStore), (store) => store.list);

test("a store without a file is empty, and hide makes the file and its folders", async () => {
  const file = await tempFile();

  expect([...(await run(file, list))]).toEqual([]);

  await run(
    file,
    Effect.flatMap(Effect.service(HiddenStore), (store) => store.hide("42")),
  );

  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(["42"]);
});

test("hidden ids persist across store instances until clear", async () => {
  const file = await tempFile();
  const hide = (id: string) =>
    run(
      file,
      Effect.flatMap(Effect.service(HiddenStore), (store) => store.hide(id)),
    );

  await hide("1");
  await hide("2");
  await hide("1");

  expect([...(await run(file, list))].toSorted()).toEqual(["1", "2"]);

  await run(
    file,
    Effect.flatMap(Effect.service(HiddenStore), (store) => store.clear),
  );

  expect([...(await run(file, list))]).toEqual([]);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual([]);
});

test("concurrent hides keep all ids", async () => {
  const file = await tempFile();
  const ids = ["1", "2", "3", "4", "5"];

  await run(
    file,
    Effect.flatMap(Effect.service(HiddenStore), (store) =>
      Effect.forEach(ids, store.hide, { concurrency: "unbounded" }),
    ),
  );

  expect([...(await run(file, list))].toSorted()).toEqual(ids);
});

test("a file that is not a list of ids fails with the path in the message", async () => {
  const file = await tempFile();
  await run(
    file,
    Effect.flatMap(Effect.service(HiddenStore), (store) => store.hide("1")),
  );
  await Bun.write(file, '{"not":"a list"}');

  const message = await run(
    file,
    Effect.match(list, { onFailure: (error) => error.message, onSuccess: () => "no error" }),
  );

  expect(message).toStartWith(file);
});
