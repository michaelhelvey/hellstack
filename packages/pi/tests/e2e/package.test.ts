import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";

import { z } from "zod";

import { installedPiVersion, PI_PACKAGES } from "../../scripts/update.ts";
import { PACKAGE_DIR, PiSandbox } from "./harness/sandbox.ts";

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

async function devDependencyVersion(name: string): Promise<string> {
  const file = path.join(PACKAGE_DIR, "node_modules", name, "package.json");
  return z.object({ version: z.string() }).parse(await Bun.file(file).json()).version;
}

test.each(PI_PACKAGES)(
  "the %s devDependency has the installed pi version, so the type check uses the same API",
  async (name) => {
    const installed = await installedPiVersion();
    const hint = `pi is at ${installed}. Run: bun run pi:update`;
    expect(await devDependencyVersion(name), hint).toBe(installed);
  },
);
