import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";

import { z } from "zod";

import { PACKAGE_DIR, PI_BIN, PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(async () => {
  await sandbox.dispose();
});

const CommandsSchema = z.object({ commands: z.array(z.object({ name: z.string() })) });

test("pi loads the package with no errors or warnings, and gives its tools to the model", async () => {
  const pi = await sandbox.startRpc();
  const { data } = await pi.request({ type: "get_commands" });
  sandbox.model.reply({ text: "Hello." });
  await pi.prompt("hello");

  const commands = CommandsSchema.parse(data).commands.map((c) => c.name);
  expect(commands).toContain("btw");
  expect(commands).toContain("goal");
  expect(commands).toContain("todos");
  const tools = sandbox.model.requests[0]?.tools.map((t) => t.function.name) ?? [];
  expect(
    ["create_goal", "get_goal", "todo", "update_goal", "web_fetch", "bash"].filter(
      (name) => !tools.includes(name),
    ),
  ).toEqual([]);
  expect(tools.filter((name) => name === "bash")).toHaveLength(1);
  expect(await pi.stop()).toBe("");
});

async function installedPiVersion(): Promise<string> {
  const proc = Bun.spawn([PI_BIN, "--version"], { stdout: "pipe", stderr: "ignore" });
  return (await new Response(proc.stdout).text()).trim();
}

async function devDependencyVersion(name: string): Promise<string> {
  const file = path.join(PACKAGE_DIR, "node_modules", name, "package.json");
  return z.object({ version: z.string() }).parse(await Bun.file(file).json()).version;
}

test.each(["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui"])(
  "the %s devDependency has the installed pi version, so the type check uses the same API",
  async (name) => {
    const installed = await installedPiVersion();
    const hint = `Run: bun add -d ${name}@${installed} --cwd packages/pi`;
    expect(await devDependencyVersion(name), hint).toBe(installed);
  },
);
