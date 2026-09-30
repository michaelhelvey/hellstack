import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

const FAKE_WEB_FETCH = `#!/bin/sh
if [ -n "$FAKE_FAIL" ]; then echo "boom" >&2; exit 3; fi
if [ -n "$FAKE_LINES" ]; then seq 1 "$FAKE_LINES"; exit 0; fi
printf 'args:'; for arg in "$@"; do printf ' [%s]' "$arg"; done
printf '\\nlightpanda: %s\\n' "$LIGHTPANDA_BIN"
`;

let sandbox: PiSandbox;
let binDir: string;

afterEach(async () => {
  await sandbox.dispose();
  await rm(binDir, { recursive: true, force: true });
});

async function startWithFakeBinary(env: Record<string, string> = {}) {
  binDir = await mkdtemp(path.join(tmpdir(), "hellstack-web-fetch-"));
  const bin = path.join(binDir, "web-fetch");
  await Bun.write(bin, FAKE_WEB_FETCH);
  await chmod(bin, 0o755);
  const lightpanda = "/opt/lightpanda";
  sandbox = await PiSandbox.create({
    env: { WEB_FETCH_BIN: bin, LIGHTPANDA_BIN: lightpanda, ...env },
  });
  return sandbox.startRpc();
}

async function fetchOnce(args: Record<string, unknown>, env: Record<string, string> = {}) {
  const pi = await startWithFakeBinary(env);
  sandbox.model.callTools({
    name: "web_fetch",
    arguments: { url: "https://example.com", ...args },
  });
  const [result] = (await pi.prompt("fetch")).toolResults();
  if (!result) throw new Error("web_fetch did not run");
  return result;
}

test("web_fetch gives the tool parameters to the binary as flags, with the URL last", async () => {
  const result = await fetchOnce({ full: true, selector: "main", wait_ms: 0 });

  expect(result).toMatchObject({ isError: false });
  expect(result.text).toBe(
    "args: [--full] [--selector] [main] [--wait-ms] [0] [--] [https://example.com]\n" +
      "lightpanda: /opt/lightpanda\n",
  );
});

test("web_fetch reports the exit code and stderr of the binary when it fails", async () => {
  const result = await fetchOnce({}, { FAKE_FAIL: "1" });

  expect(result.isError).toBe(true);
  expect(result.text).toContain("web-fetch failed (3): boom");
});

test("web_fetch truncates a long page and saves the full page to a file", async () => {
  const result = await fetchOnce({}, { FAKE_LINES: "5000" });
  const details = z.object({ truncated: z.boolean(), fullOutputPath: z.string() });
  const { truncated, fullOutputPath } = details.parse(result.details);

  expect(truncated).toBe(true);
  expect(result.text).toContain(`Full output saved to: ${fullOutputPath}`);
  expect(result.text).not.toContain("\n4999\n");
  expect((await Bun.file(fullOutputPath).text()).split("\n")).toHaveLength(5001);
});
