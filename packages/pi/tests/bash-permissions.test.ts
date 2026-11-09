import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { PiSandbox } from "./pi.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(() => sandbox.dispose());

const bash = async (command: string) => {
  sandbox.model.callTools({ name: "bash", arguments: { command } });
  const [result] = await sandbox.rpc().prompt("run it");
  return result;
};

test("blocks aws sso login and does not run it", async () => {
  const result = await bash("touch ran && aws  sso login --profile prod");

  expect(result?.isError).toBe(true);
  expect(result?.text).toContain("blocked pattern");
  expect(await readdir(sandbox.workDir)).not.toContain("ran");
});

test("runs other commands", async () => {
  const result = await bash("echo aws sso logout");

  expect(result).toMatchObject({ isError: false, text: expect.stringContaining("aws sso logout") });
});
