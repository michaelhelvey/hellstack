import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { LAYERS, setup, SetupEnv } from "../src/setup.ts";

let root: string;
const packageDir = () => path.join(root, "package");
const agentDir = () => path.join(root, "agent");

const write = async (file: string, content: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

const runSetup = (username = "nobody") =>
  Effect.runPromise(
    setup.pipe(
      Effect.provideService(SetupEnv, { packageDir: packageDir(), agentDir: agentDir(), username }),
      Effect.provide(BunServices.layer),
    ),
  );

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "hellstack-setup-"));
  await write(path.join(packageDir(), "agent", "AGENTS.md"), "new instructions\n");
  await write(
    path.join(packageDir(), "agent", "settings.json"),
    JSON.stringify({ quietStartup: true, terminal: { clearOnShrink: true }, skills: ["-x"] }),
  );
  await write(path.join(packageDir(), "agent", "skills", "review", "SKILL.md"), "review");
  await write(path.join(packageDir(), "agent", "layers", "personal.md"), "personal layer\n");
  await write(path.join(packageDir(), "agent", "layers", "transport4.md"), "work layer\n");
});

afterEach(() => rm(root, { recursive: true, force: true }));

test("deep merges the settings: hellstack wins, local-only keys stay, and arrays are a union", async () => {
  await write(
    path.join(agentDir(), "settings.json"),
    JSON.stringify({
      theme: "dark",
      quietStartup: false,
      terminal: { mine: 1 },
      skills: ["-x", "-mine"],
      packages: ["npm:mine"],
    }),
  );

  await runSetup();
  await runSetup();

  expect(await readJson(path.join(agentDir(), "settings.json"))).toEqual({
    theme: "dark",
    quietStartup: true,
    terminal: { mine: 1, clearOnShrink: true },
    skills: ["-x", "-mine"],
    packages: ["npm:mine", packageDir()],
  });
});

test("replaces an AGENTS.md link without changing the file that it points to", async () => {
  await write(path.join(root, "old.md"), "old instructions\n");
  await mkdir(agentDir(), { recursive: true });
  await symlink(path.join(root, "old.md"), path.join(agentDir(), "AGENTS.md"));

  await runSetup();

  expect(await readFile(path.join(agentDir(), "AGENTS.md"), "utf8")).toEqual("new instructions\n");
  expect(await readFile(path.join(root, "old.md"), "utf8")).toEqual("old instructions\n");
});

test("replaces hellstack skills and keeps other skills", async () => {
  await write(path.join(agentDir(), "skills", "review", "stale.md"), "stale");
  await write(path.join(agentDir(), "skills", "mine", "SKILL.md"), "mine");

  await runSetup();

  expect((await readdir(path.join(agentDir(), "skills"))).toSorted()).toEqual(["mine", "review"]);
  expect(await readdir(path.join(agentDir(), "skills", "review"))).toEqual(["SKILL.md"]);
});

test("appends the layer of the current user to AGENTS.md, one time", async () => {
  await runSetup("helvetici");
  await runSetup("helvetici");

  expect(await readFile(path.join(agentDir(), "AGENTS.md"), "utf8")).toEqual(
    "new instructions\n\npersonal layer\n",
  );
});

test("does not append a layer for an unknown user", async () => {
  await runSetup("somebody-else");

  expect(await readFile(path.join(agentDir(), "AGENTS.md"), "utf8")).toEqual("new instructions\n");
});

test("each layer file exists in the package", async () => {
  const layers = await readdir(path.resolve(import.meta.dir, "..", "agent", "layers"));
  expect(layers.toSorted()).toEqual(Object.values(LAYERS).toSorted());
});
