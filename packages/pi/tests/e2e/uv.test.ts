import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(async () => {
  await sandbox.dispose();
});

test("the bash tool blocks pip, tells the agent to use uv, and does not run the command", async () => {
  const pi = await sandbox.startRpc();
  sandbox.model.callTools({ name: "bash", arguments: { command: "touch ran; pip install x" } });
  const [result] = (await pi.prompt("install")).toolResults();

  expect(result?.isError).toBe(true);
  expect(result?.text).toContain("Error: pip is disabled. Use uv instead:");
  expect(result?.text).toContain("uv add PACKAGE");
  expect(existsSync(path.join(sandbox.workDir, "ran"))).toBe(false);
});

test("the bash tool runs a permitted command in the working folder", async () => {
  const pi = await sandbox.startRpc();
  sandbox.model.callTools({
    name: "bash",
    arguments: { command: "echo hi > out.txt; cat out.txt" },
  });
  const [result] = (await pi.prompt("run")).toolResults();

  expect(result).toMatchObject({ isError: false, text: "hi\n" });
  expect(await Bun.file(path.join(sandbox.workDir, "out.txt")).text()).toBe("hi\n");
});
