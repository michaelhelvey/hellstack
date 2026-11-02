import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(async () => {
  await sandbox.dispose();
});

test("the /context command shows the sources of the context window in the TUI", async () => {
  sandbox.model.reply({ text: "Done." });
  const pi = sandbox.startTui();

  await pi.waitFor("fake-1");
  await pi.submit("hello");
  await pi.waitFor("Done.");
  await pi.submit("/context");
  const output = await pi.waitFor("Context ·");

  expect(output).toContain("System prompt");
  expect(output).toContain("Tool definitions");

  pi.type("\x1b[6~".repeat(4));
  expect(await pi.waitFor("Conversation")).toContain("Conversation");
  expect(output).toContain("esc to close");
});

test("the /context command sends the report as a notification in RPC mode", async () => {
  const pi = await sandbox.startRpc();
  const notified = pi.nextUiRequest("notify");
  await pi.request({ type: "prompt", message: "/context" });
  const message = (await notified).message ?? "";

  expect(message).toContain("Context ·");
  expect(message).toContain("System prompt");
  expect(message).toContain("Token counts are estimates");
});
