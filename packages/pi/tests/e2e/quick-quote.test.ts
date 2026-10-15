import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

const REPLY = [
  "Alpha paragraph about worktrees.",
  "Beta paragraph about pruning branches.",
  "Gamma paragraph about tags.",
].join("\n\n");

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(async () => {
  await sandbox.dispose();
});

async function waitForRequests(count: number): Promise<void> {
  for (let i = 0; i < 100 && sandbox.model.requests.length < count; i++) await Bun.sleep(50);
}

test("> opens a picker that inserts a quote of the last reply", async () => {
  sandbox.model.reply({ text: REPLY }, { text: "Done." });
  const pi = sandbox.startTui();
  await pi.waitFor("fake-1");
  await pi.submit("hello");
  await pi.waitFor("Gamma paragraph about tags.");

  pi.type(">");
  await pi.waitFor("1/3");
  pi.type("\x0e");
  await pi.waitFor("2/3");
  pi.type(" pruning   branches");
  await pi.waitFor("1/1");
  pi.type("\r");
  pi.type("why?\r");
  await waitForRequests(2);

  const prompt = JSON.stringify(sandbox.model.requests[1]?.messages.at(-1)?.content);
  expect(prompt).toContain("> Beta paragraph about pruning branches.\\n\\nwhy?");
});

test("escape closes the picker for the line, and enter then sends the text", async () => {
  sandbox.model.reply({ text: REPLY }, { text: "Done." });
  const pi = sandbox.startTui();
  await pi.waitFor("fake-1");
  await pi.submit("hello");
  await pi.waitFor("Gamma paragraph about tags.");

  pi.type(">");
  await pi.waitFor("1/3");
  pi.type("\x1b");
  await Bun.sleep(100);
  pi.type(" my own words\r");
  await waitForRequests(2);

  const prompt = JSON.stringify(sandbox.model.requests[1]?.messages.at(-1)?.content);
  expect(prompt).toContain("> my own words");
});
