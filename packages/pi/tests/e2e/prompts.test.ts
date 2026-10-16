import { afterEach, expect, setDefaultTimeout, test } from "bun:test";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

afterEach(async () => {
  await sandbox.dispose();
});

async function systemPrompt(env: Record<string, string> = {}): Promise<string> {
  sandbox = await PiSandbox.create({ env });
  const pi = await sandbox.startRpc();
  sandbox.model.reply({ text: "Hello." });
  await pi.prompt("hello");
  expect(await pi.stop()).toBe("");
  const system = sandbox.model.requests[0]?.messages.find((message) => message.role === "system");
  return JSON.stringify(system);
}

test("every session gets the instructions, the chinchilla voice, pstack, and the skills", async () => {
  const system = await systemPrompt();
  expect(system).toContain("You are a small, feral chinchilla");
  expect(system).toContain("Protect Your Time");
  expect(system).toContain("Load the `poteto-mode` skill");
  expect(system).toContain("## pstack in pi");
  expect(system).toContain("every role runs on the session model");
  expect(system).toContain("<name>poteto-mode</name>");
});

test("a subagent talks like a chinchilla but does not get the poteto-mode mandate", async () => {
  const system = await systemPrompt({ HELLSTACK_SUBAGENT: "1" });
  expect(system).toContain("You are a small, feral chinchilla");
  expect(system).toContain("## pstack in pi");
  expect(system).not.toContain("Load the `poteto-mode` skill");
});

test("the pstack models sheet of the machine is in the prompt", async () => {
  sandbox = await PiSandbox.create();
  await Bun.write(`${sandbox.agentDir}/pstack-models.md`, "- swarm workers: a/b\n");
  const pi = await sandbox.startRpc();
  sandbox.model.reply({ text: "Hello." });
  await pi.prompt("hello");
  expect(await pi.stop()).toBe("");
  expect(JSON.stringify(sandbox.model.requests[0]?.messages)).toContain("swarm workers: a/b");
});
