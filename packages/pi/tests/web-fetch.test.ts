import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { PiSandbox } from "./pi.ts";

setDefaultTimeout(30_000);

const FAKE_WEB_FETCH = `#!/bin/sh
if [ -n "$FAKE_FAIL" ]; then echo "boom" >&2; exit 3; fi
if [ -n "$FAKE_LINES" ]; then seq 1 "$FAKE_LINES"; exit 0; fi
printf 'args:'; for arg in "$@"; do printf ' [%s]' "$arg"; done
printf '\\nlightpanda: %s\\n' "$LIGHTPANDA_BIN"
`;

const REAL_WEB_FETCH = path.join(os.homedir(), ".cargo", "bin", "web-fetch");
const REAL_LIGHTPANDA = path.join(os.homedir(), ".local", "bin", "lightpanda");

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(() => sandbox.dispose());

const fetchPage = async (args: Record<string, unknown>, env: Record<string, string>) => {
  sandbox.model.callTools({
    name: "web_fetch",
    arguments: { url: "https://example.com", ...args },
  });
  const [result] = await sandbox.rpc(env).prompt("fetch");
  if (!result) throw new Error("web_fetch did not run");
  return result;
};

const fakeEnv = async (env: Record<string, string> = {}) => {
  const bin = path.join(sandbox.root, "web-fetch");
  await sandbox.write("web-fetch", FAKE_WEB_FETCH);
  await chmod(bin, 0o755);
  return { WEB_FETCH_BIN: bin, LIGHTPANDA_BIN: "/opt/lightpanda", ...env };
};

test("gives the tool parameters to web-fetch as flags, with the URL last", async () => {
  const result = await fetchPage({ full: true, selector: "main", wait_ms: 0 }, await fakeEnv());

  expect(result.isError).toBe(false);
  expect(result.text).toBe(
    "args: [--full] [--selector] [main] [--wait-ms] [0] [--] [https://example.com]\n" +
      "lightpanda: /opt/lightpanda\n",
  );
});

test("reports the exit code and stderr of web-fetch when it fails", async () => {
  const result = await fetchPage({}, await fakeEnv({ FAKE_FAIL: "1" }));

  expect(result.isError).toBe(true);
  expect(result.text).toContain("web-fetch failed (3): boom");
});

test("truncates a long page and saves the full page to a file", async () => {
  const result = await fetchPage({}, await fakeEnv({ FAKE_LINES: "5000" }));
  const { fullOutputPath } = z.object({ fullOutputPath: z.string() }).parse(result.details);

  expect(result.text).toContain(`Full output saved to: ${fullOutputPath}`);
  expect(result.text).not.toContain("\n4999\n");
  expect((await Bun.file(fullOutputPath).text()).split("\n")).toHaveLength(5001);
});

test.skipIf(!existsSync(REAL_WEB_FETCH) || !existsSync(REAL_LIGHTPANDA))(
  "renders a page that JavaScript changes as Markdown with the real web-fetch",
  async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(
          `<html><body><main><h1>Static title</h1><p id="p">old</p></main>
<script>document.getElementById("p").textContent = "Rendered by script";</script></body></html>`,
          { headers: { "content-type": "text/html" } },
        ),
    });
    try {
      const result = await fetchPage(
        { url: `http://127.0.0.1:${server.port}/` },
        { WEB_FETCH_BIN: REAL_WEB_FETCH, LIGHTPANDA_BIN: REAL_LIGHTPANDA },
      );

      expect(result.isError).toBe(false);
      expect(result.text).toContain("# Static title");
      expect(result.text).toContain("Rendered by script");
    } finally {
      await server.stop(true);
    }
  },
);
