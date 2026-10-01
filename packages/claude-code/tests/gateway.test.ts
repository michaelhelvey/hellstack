import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { gatewayAuthPath, gatewayIntegration } from "../src/gateway.ts";

let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "hellstack-gateway-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

async function writeAuth(text: string): Promise<void> {
  await mkdir(dirname(join(home, gatewayAuthPath)), { recursive: true });
  await writeFile(join(home, gatewayAuthPath), text);
}

test("gatewayIntegration returns undefined when the auth file does not exist", async () => {
  expect(await gatewayIntegration(home)).toBeUndefined();
});

test("gatewayIntegration passes the token to the command and hides it in the output", async () => {
  await writeAuth(JSON.stringify({ token: "secret-token", gatewayUrl: "https://example.com" }));
  const integration = await gatewayIntegration(home);
  expect(integration?.command).toEqual([
    "bunx",
    "@transport4/ai-gateway",
    "setup",
    "claude-code",
    "--key",
    "secret-token",
  ]);
  expect(integration?.display).not.toContain("secret-token");
});

test("gatewayIntegration rejects an auth file without a token", async () => {
  await writeAuth("{}");
  const error = await gatewayIntegration(home).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
});
