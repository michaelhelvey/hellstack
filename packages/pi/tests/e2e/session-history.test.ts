import { afterEach, expect, setDefaultTimeout, test } from "bun:test";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

afterEach(async () => {
  await sandbox.dispose();
});

const SCRIPT = `
const { hits } = await tools.session_search({ query: "raisin inventory" });
const { session, items } = await tools.session_read({ session: hits[0].sessionId });
return { current: session.current, texts: items.map((item) => item.role + ": " + item.text) };
`;

test("codemode scripts can search and read the session history", async () => {
  sandbox = await PiSandbox.create();
  const pi = await sandbox.startRpc();
  sandbox.model.reply({ text: "Counted them." });
  await pi.prompt("do the raisin inventory");
  sandbox.model.callTools({ name: "codemode", arguments: { code: SCRIPT } });

  const results = (await pi.prompt("what did we do?")).toolResults();
  const result = results.find((r) => r.toolName === "codemode");

  expect(results.map((r) => r.toolName)).toEqual(["session_search", "session_read", "codemode"]);
  expect(result).toMatchObject({ isError: false });
  expect(result?.text).toContain('"current":true');
  expect(result?.text).toContain('"user: do the raisin inventory"');
  expect(result?.text).toContain('"assistant: Counted them."');
});
