import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { gatewayAuthPath, gatewayPlan } from "../src/gateway.ts";

let home: string;
let settingsPath: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "hellstack-gateway-"));
  settingsPath = join(home, ".claude", "settings.json");
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

async function writeAuth(text: string): Promise<void> {
  await mkdir(dirname(join(home, gatewayAuthPath)), { recursive: true });
  await writeFile(join(home, gatewayAuthPath), text);
}

async function writeSettings(env: Record<string, string>): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({ env }));
}

const gatewayEnv = {
  ANTHROPIC_BASE_URL: "https://example.com/api/anthropic",
  ANTHROPIC_CUSTOM_HEADERS: "x-t4-aig-token: secret-token",
};

test("gatewayPlan returns undefined when the auth file does not exist", async () => {
  expect(await gatewayPlan(home, settingsPath)).toBeUndefined();
});

test("gatewayPlan runs the setup and hides the token when the settings do not exist", async () => {
  await writeAuth(JSON.stringify({ token: "secret-token", gatewayUrl: "https://example.com" }));
  const plan = await gatewayPlan(home, settingsPath);
  if (plan === undefined || !("integration" in plan)) throw new Error("expected an integration");
  expect(plan.integration.command).toEqual([
    "bunx",
    "@transport4/ai-gateway",
    "setup",
    "claude-code",
    "--key",
    "secret-token",
  ]);
  expect(plan.integration.display).not.toContain("secret-token");
});

test("gatewayPlan keeps the settings env when it has the token", async () => {
  await writeAuth(JSON.stringify({ token: "secret-token" }));
  await writeSettings({ ...gatewayEnv, OTHER: "value" });
  expect(await gatewayPlan(home, settingsPath)).toEqual({ env: gatewayEnv });
});

test("gatewayPlan runs the setup when the settings have a different token", async () => {
  await writeAuth(JSON.stringify({ token: "new-token" }));
  await writeSettings(gatewayEnv);
  expect(await gatewayPlan(home, settingsPath)).toHaveProperty("integration");
});

test("gatewayPlan rejects an auth file without a token", async () => {
  await writeAuth("{}");
  const error = await gatewayPlan(home, settingsPath).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
});
