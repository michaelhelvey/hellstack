import { afterEach, expect, setDefaultTimeout, test } from "bun:test";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

afterEach(async () => {
  await sandbox.dispose();
});

const HERDR_PANE_ENV = {
  HERDR_ENV: "1",
  HERDR_SOCKET_PATH: "/tmp/herdr-test.sock",
  HERDR_WORKSPACE_ID: "w1",
  HERDR_PANE_ID: "p1",
};

async function systemPrompt(env: Record<string, string> = {}): Promise<string> {
  sandbox = await PiSandbox.create({ env });
  const pi = await sandbox.startRpc();
  sandbox.model.reply({ text: "Hello." });
  await pi.prompt("hello");
  expect(await pi.stop()).toBe("");
  const system = sandbox.model.requests[0]?.messages.find((message) => message.role === "system");
  return JSON.stringify(system);
}

test("pi does not load the herdr skill outside herdr", async () => {
  const system = await systemPrompt();
  expect(system).toContain("<name>pr</name>");
  expect(system).not.toContain("<name>herdr</name>");
});

test("pi loads the herdr skill in a herdr pane", async () => {
  const system = await systemPrompt(HERDR_PANE_ENV);
  expect(system).toContain("<name>herdr</name>");
});
