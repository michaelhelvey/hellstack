import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Integration } from "@hellstack/sync";
import { z } from "zod";

const authSchema = z.looseObject({ token: z.string().min(1) });

const settingsSchema = z.looseObject({
  env: z.looseObject({
    ANTHROPIC_BASE_URL: z.string().min(1),
    ANTHROPIC_CUSTOM_HEADERS: z.string(),
  }),
});

/** The path of the AI gateway auth file, relative to the home directory. */
export const gatewayAuthPath = join(".config", ".t4-ai-gateway", "auth.json");

/** The settings environment variables that the AI gateway setup writes. */
export type GatewayEnv = Record<"ANTHROPIC_BASE_URL" | "ANTHROPIC_CUSTOM_HEADERS", string>;

/**
 * How the sync sets up the AI gateway. `env` holds the gateway variables to keep in
 * `settings.json`. `integration` runs the gateway setup.
 */
export type GatewayPlan = { env: GatewayEnv } | { integration: Integration };

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

async function currentEnv(settingsPath: string, token: string): Promise<GatewayEnv | undefined> {
  const text = await readText(settingsPath);
  const json: unknown = text === undefined ? undefined : JSON.parse(text);
  const parsed = settingsSchema.safeParse(json);
  if (!parsed.success || !parsed.data.env.ANTHROPIC_CUSTOM_HEADERS.includes(token))
    return undefined;
  const { ANTHROPIC_BASE_URL, ANTHROPIC_CUSTOM_HEADERS } = parsed.data.env;
  return { ANTHROPIC_BASE_URL, ANTHROPIC_CUSTOM_HEADERS };
}

function setupIntegration(token: string): Integration {
  const args = ["@transport4/ai-gateway", "setup", "claude-code", "--key"];
  return {
    name: "ai-gateway (Claude Code)",
    command: ["bunx", ...args, token],
    display: ["bunx", ...args, "<token>"].join(" "),
  };
}

/**
 * Makes the plan that sets up the AI gateway for Claude Code with the token from the gateway auth
 * file. The sync writes `settings.json` without the gateway config. When `settingsPath` already has
 * the gateway config with the token, the plan keeps that config, and the setup does not run again.
 * If not, the plan runs the setup after the sync. Returns `undefined` when the auth file does not
 * exist.
 */
export async function gatewayPlan(
  home: string,
  settingsPath: string,
): Promise<GatewayPlan | undefined> {
  const text = await readText(join(home, gatewayAuthPath));
  if (text === undefined) return undefined;
  const { token } = authSchema.parse(JSON.parse(text));
  const env = await currentEnv(settingsPath, token);
  return env === undefined ? { integration: setupIntegration(token) } : { env };
}
