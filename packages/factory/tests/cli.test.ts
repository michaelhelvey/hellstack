import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { main } from "../src/cli.ts";
import { getTask, ledgerPaths } from "../src/core/index.ts";
import { tempFolder } from "./core/helpers.ts";

const designedSchema = z.object({ task: z.string(), terminal: z.string() });

const saved = { home: process.env.FACTORY_HOME, path: process.env.PATH };

afterEach(() => {
  if (saved.home === undefined) delete process.env.FACTORY_HOME;
  else process.env.FACTORY_HOME = saved.home;
  process.env.PATH = saved.path;
});

const FAKE_HC = `#!/bin/sh
echo "$*" >> "$(dirname "$0")/calls"
case "$1" in
  ls) echo '{"terminals":[]}' ;;
  get) echo '{"error":{"kind":"not_found","message":"no terminal"}}' >&2; exit 1 ;;
  run) echo '{"address":"t9","cwd":"/","state":"live","turn":0}' ;;
esac
`;

const NO_WINDOW = `#!/bin/sh
echo "no Herdr window" >&2
exit 1
`;

async function fakeBin(): Promise<string> {
  const bin = await tempFolder();
  await writeFile(join(bin, "hc"), FAKE_HC);
  await writeFile(join(bin, "herdr-app"), NO_WINDOW);
  await Promise.all(["hc", "herdr-app"].map((name) => chmod(join(bin, name), 0o755)));
  process.env.PATH = `${bin}:${saved.path}`;
  return bin;
}

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

test("design makes an untitled sketch in FACTORY_HOME and starts its design agent", async () => {
  const home = await tempFolder();
  process.env.FACTORY_HOME = home;
  const bin = await fakeBin();
  const log = spyOn(console, "log").mockImplementation(() => undefined);

  expect(await main(["design", "--json"])).toBe(0);
  const printed: unknown = JSON.parse(String(log.mock.calls[0]?.[0]));
  log.mockRestore();

  const { task, terminal } = designedSchema.parse(printed);
  expect(terminal).toBe(`factory-design-${task}`);
  expect((await getTask(task, ledgerPaths(home))).meta).toMatchObject({
    title: "untitled",
    status: "sketch",
    cwd: home,
  });
  const calls = await readFile(join(bin, "calls"), "utf8");
  expect(calls).toContain(
    `run --json --bg --no-parent --name factory-design-${task} --cwd ${home}`,
  );
});

test("an unknown command exits with 2", async () => {
  expect(await main(["nope"])).toBe(2);
  expect(await main([])).toBe(2);
});
