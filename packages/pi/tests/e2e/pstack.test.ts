import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPstack } from "@hellstack/pstack";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

const PSTACK_PACKAGE_DIR = path.resolve(import.meta.dir, "../../../pstack");

let pstackDir: string;
let sandbox: PiSandbox;

beforeAll(async () => {
  pstackDir = await mkdtemp(path.join(tmpdir(), "hellstack-pstack-e2e-"));
  for (const [file, data] of await buildPstack(PSTACK_PACKAGE_DIR)) {
    const target = path.join(pstackDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data.content);
    await chmod(target, data.mode & 0o777);
  }
});

afterEach(async () => {
  await sandbox.dispose();
});

afterAll(async () => {
  await rm(pstackDir, { recursive: true, force: true });
});

async function firstRequest(env: Record<string, string> = {}) {
  sandbox = await PiSandbox.create({ extensions: [path.join(pstackDir, "pi", "index.ts")], env });
  const pi = await sandbox.startRpc();
  sandbox.model.reply({ text: "Hello." });
  await pi.prompt("hello");
  expect(await pi.stop()).toBe("");
  const request = sandbox.model.requests[0];
  if (request === undefined) throw new Error("pi sent no request");
  const system = request.messages.find((message) => message.role === "system");
  return { tools: request.tools.map((t) => t.function.name), system: JSON.stringify(system) };
}

test("pi loads the patched pstack extension without the pstack agent tools", async () => {
  const { tools, system } = await firstRequest();
  expect(tools).toContain("ask_user_question");
  expect(tools).toContain("schedule_wakeup");
  expect(tools).toContain("subagent_start");
  expect(tools.filter((name) => ["agent", "send_message", "stop_agent"].includes(name))).toEqual(
    [],
  );
  expect(system).toContain("You have pstack.");
});

test("a herdr subagent gets the pstack tool mapping but not the poteto-mode mandate", async () => {
  const { system } = await firstRequest({ HELLSTACK_SUBAGENT: "1" });
  expect(system).toContain("pi-tools.md");
  expect(system).not.toContain("You have pstack.");
});
