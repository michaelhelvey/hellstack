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

test("every session gets the instructions, the chinchilla voice, and the skills", async () => {
  const system = await systemPrompt();
  expect(system).toContain("You are a small, feral chinchilla");
  expect(system).toContain("Protect Your Time");
  expect(system).toContain("<name>pr</name>");
});
