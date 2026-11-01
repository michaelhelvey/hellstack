import { afterEach, expect, setDefaultTimeout, test } from "bun:test";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

afterEach(async () => {
  await sandbox.dispose();
});

const HERDR_PANE_ENV = {
  HC_TERMINAL_ID: "t1",
  HC_TERMINAL_SOCKET: "/tmp/herdr-core-test.sock",
};

const REX_PANE_ENV = { REX_SESSION: "session:1", REX_BLOCK: "block:1" };

async function systemPrompt(env: Record<string, string> = {}): Promise<string> {
  sandbox = await PiSandbox.create({ env });
  const pi = await sandbox.startRpc();
  sandbox.model.reply({ text: "Hello." });
  await pi.prompt("hello");
  expect(await pi.stop()).toBe("");
  const system = sandbox.model.requests[0]?.messages.find((message) => message.role === "system");
  return JSON.stringify(system);
}

test("pi loads no multiplexer skill and no multiplexer section outside a multiplexer", async () => {
  const system = await systemPrompt();
  expect(system).toContain("<name>pr</name>");
  expect(system).not.toContain("<name>herdr</name>");
  expect(system).not.toContain("<name>rex</name>");
  expect(system).not.toContain("<multiplexer>");
});

test("pi loads only the herdr skill and section in a herdr-core terminal", async () => {
  const system = await systemPrompt(HERDR_PANE_ENV);
  expect(system).toContain("<name>herdr</name>");
  expect(system).not.toContain("<name>rex</name>");
  expect(system).toContain("Load the `herdr` skill");
  expect(system).toContain("Use `hc` to start");
});

test("pi loads only the rex skill and section in a Rex pane", async () => {
  const system = await systemPrompt(REX_PANE_ENV);
  expect(system).toContain("<name>rex</name>");
  expect(system).not.toContain("<name>herdr</name>");
  expect(system).toContain("Load the `rex` skill");
});

test("herdr has priority over Rex when pi runs in a herdr terminal in a Rex terminal", async () => {
  const system = await systemPrompt({ ...REX_PANE_ENV, ...HERDR_PANE_ENV });
  expect(system).toContain("<name>herdr</name>");
  expect(system).not.toContain("<name>rex</name>");
});
