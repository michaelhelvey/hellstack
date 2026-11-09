import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import type { FakeRequest } from "./fake-model.ts";
import { PiSandbox } from "./pi.ts";
import type { TuiPi } from "./tui.ts";

setDefaultTimeout(30_000);

const REPLY = [
  "Alpha paragraph about worktrees.",
  "- Beta item about pruning branches.",
  "Gamma paragraph about tags.",
].join("\n\n");

let sandbox: PiSandbox;
let pi: TuiPi;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
  sandbox.model.reply(REPLY, "Done.");
  pi = sandbox.tui();
  await pi.submit("hello");
  await pi.waitFor("Gamma paragraph about tags.");
});

afterEach(() => sandbox.dispose());

const secondRequest = async (deadline = Date.now() + 5000): Promise<FakeRequest> => {
  const request = sandbox.model.requests[1];
  if (request) return request;
  if (Date.now() > deadline) throw new Error("pi did not send a second prompt");
  await Bun.sleep(50);
  return secondRequest(deadline);
};

const lastPrompt = async () => JSON.stringify((await secondRequest()).messages.at(-1)?.content);

test("> opens a picker that filters the blocks of the last reply and inserts one as a quote", async () => {
  pi.type(">");
  await pi.waitFor("1/3");
  pi.type("\x0e");
  await pi.waitFor("2/3");
  pi.type(" pruning   branches");
  await pi.waitFor("1/1");
  pi.type("\r");
  await pi.submit("why?");

  expect(await lastPrompt()).toContain("> - Beta item about pruning branches.\\n\\nwhy?");
});

test("escape closes the picker for the line, and enter then sends the text", async () => {
  pi.type(">");
  await pi.waitFor("1/3");
  pi.type("\x1b");
  await Bun.sleep(100);
  await pi.submit(" my own words");

  expect(await lastPrompt()).toContain("> my own words");
});
