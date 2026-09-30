import { afterEach, beforeEach, setDefaultTimeout, test } from "bun:test";

import { WORKING_MESSAGES } from "../../src/whimsical/messages.ts";
import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(async () => {
  await sandbox.dispose();
});

function anyOf(texts: readonly string[]): RegExp {
  return new RegExp(texts.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
}

test("pi shows a whimsical working message while the model works", async () => {
  sandbox.model.reply({ text: "Done.", delayMs: 3000 });
  const pi = sandbox.startTui();
  await pi.waitFor("fake-1");
  await pi.submit("hello");

  await pi.waitFor(anyOf(WORKING_MESSAGES));
});
