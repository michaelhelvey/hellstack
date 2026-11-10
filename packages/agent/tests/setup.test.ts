import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { type Harness } from "../src/harness.ts";
import { LAYERS, setup, SetupEnv } from "../src/setup.ts";

let root: string;
const sourceDir = () => path.join(root, "source");
const harnessDir = (name: string) => path.join(root, name);

const write = async (file: string, content: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

const harnesses = (): ReadonlyArray<Harness> => [
  {
    name: "one",
    dir: harnessDir("one"),
    directories: { agents: path.join(root, "opencode-agents") },
    configs: {
      "settings.json": { quietStartup: true, terminal: { clearOnShrink: true }, skills: ["-x"] },
    },
  },
  {
    name: "two",
    dir: harnessDir("two"),
    directories: {},
    configs: { "two.json": { mcp: { servers: { jira: { a: 1 } } } } },
  },
];

const runSetup = (username = "nobody") =>
  Effect.runPromise(
    setup.pipe(
      Effect.provideService(SetupEnv, {
        sourceDir: sourceDir(),
        harnesses: harnesses(),
        username,
      }),
      Effect.provide(BunServices.layer),
    ),
  );

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "hellstack-setup-"));
  await write(path.join(sourceDir(), "AGENTS.md"), "new instructions\n");
  await mkdir(path.join(root, "opencode-agents"), { recursive: true });
  await write(path.join(sourceDir(), "skills", "review", "SKILL.md"), "review");
  await write(path.join(sourceDir(), "layers", "personal.md"), "personal layer\n");
  await write(path.join(sourceDir(), "layers", "transport4.md"), "work layer\n");
});

afterEach(() => rm(root, { recursive: true, force: true }));

test("deep merges the config of each harness: hellstack wins, local keys stay, arrays are a union", async () => {
  await write(
    path.join(harnessDir("one"), "settings.json"),
    JSON.stringify({
      theme: "dark",
      quietStartup: false,
      terminal: { mine: 1 },
      skills: ["-mine"],
    }),
  );
  await write(
    path.join(harnessDir("two"), "two.json"),
    JSON.stringify({ mcp: { servers: { mine: { b: 2 } } } }),
  );

  await runSetup();
  await runSetup();

  expect(await readJson(path.join(harnessDir("one"), "settings.json"))).toEqual({
    theme: "dark",
    quietStartup: true,
    terminal: { mine: 1, clearOnShrink: true },
    skills: ["-mine", "-x"],
  });
  expect(await readJson(path.join(harnessDir("two"), "two.json"))).toEqual({
    mcp: { servers: { mine: { b: 2 }, jira: { a: 1 } } },
  });
});

test("installs the same AGENTS.md and skills into each harness", async () => {
  await runSetup();

  const installed = await Promise.all(
    ["one", "two"].map(async (name) => ({
      agents: await readFile(path.join(harnessDir(name), "AGENTS.md"), "utf8"),
      skills: await readdir(path.join(harnessDir(name), "skills")),
    })),
  );

  expect(installed).toEqual([
    { agents: "new instructions\n", skills: ["review"] },
    { agents: "new instructions\n", skills: ["review"] },
  ]);
});

test("replaces an AGENTS.md link without changing the file that it points to", async () => {
  await write(path.join(root, "old.md"), "old instructions\n");
  await mkdir(harnessDir("one"), { recursive: true });
  await symlink(path.join(root, "old.md"), path.join(harnessDir("one"), "AGENTS.md"));

  await runSetup();

  expect(await readFile(path.join(harnessDir("one"), "AGENTS.md"), "utf8")).toBe(
    "new instructions\n",
  );
  expect(await readFile(path.join(root, "old.md"), "utf8")).toBe("old instructions\n");
});

test("replaces hellstack skills and keeps other skills", async () => {
  await write(path.join(harnessDir("one"), "skills", "review", "stale.md"), "stale");
  await write(path.join(harnessDir("one"), "skills", "mine", "SKILL.md"), "mine");

  await runSetup();

  expect((await readdir(path.join(harnessDir("one"), "skills"))).toSorted()).toEqual([
    "mine",
    "review",
  ]);
  expect(await readdir(path.join(harnessDir("one"), "skills", "review"))).toEqual(["SKILL.md"]);
});

test("installs and updates custom agents only in the configured harness and keeps local agents", async () => {
  const agent = "---\nmode: primary\ndescription: Reviews changes\n---\nReview changes.\n";
  const source = path.join(root, "opencode-agents", "reviewer.md");
  const target = path.join(harnessDir("one"), "agents");
  await write(source, "old agent");
  await write(path.join(root, "opencode-agents", ".gitkeep"), "");
  await write(path.join(target, "local.md"), "local agent");

  await runSetup();
  await write(source, agent);
  await runSetup();

  expect(await readFile(path.join(target, "reviewer.md"), "utf8")).toBe(agent);
  expect(await readFile(path.join(target, "local.md"), "utf8")).toBe("local agent");
  expect((await readdir(target)).toSorted()).toEqual(["local.md", "reviewer.md"]);
  expect(await readdir(harnessDir("two"))).not.toContain("agents");
});

test.each([
  ["helvetici", "new instructions\n\npersonal layer\n"],
  ["michaelhelvey", "new instructions\n\nwork layer\n"],
  ["somebody-else", "new instructions\n"],
])("appends the layer of user %s to AGENTS.md, one time", async (username, expected) => {
  await runSetup(username);
  await runSetup(username);

  expect(await readFile(path.join(harnessDir("two"), "AGENTS.md"), "utf8")).toBe(expected);
});

test("each layer file exists in the package", async () => {
  const layers = await readdir(path.resolve(import.meta.dir, "..", "layers"));
  expect(layers.toSorted()).toEqual(Object.values(LAYERS).toSorted());
});
