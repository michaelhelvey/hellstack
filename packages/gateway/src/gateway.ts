import { join } from "node:path";

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

/** The setup command of the AI gateway, without the token. */
export const setupCommand = ["bunx", "@transport4/ai-gateway", "setup", "claude-code", "--key"];

/** The gateway environment variables that the setup writes to the Claude Code settings. */
export type GatewayEnv = Record<"ANTHROPIC_BASE_URL" | "ANTHROPIC_CUSTOM_HEADERS", string>;

/** What this tool must do for the current auth file and settings file. */
export type GatewayPlan =
  { kind: "none" } | { kind: "ready" } | { kind: "setup"; command: string[] };

/**
 * Returns the gateway environment of `settings` when it holds the gateway variables with `token`.
 * Returns `undefined` when the settings do not have the token.
 */
export function gatewayEnvIn(settings: unknown, token: string): GatewayEnv | undefined {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success || !parsed.data.env.ANTHROPIC_CUSTOM_HEADERS.includes(token))
    return undefined;
  const { ANTHROPIC_BASE_URL, ANTHROPIC_CUSTOM_HEADERS } = parsed.data.env;
  return { ANTHROPIC_BASE_URL, ANTHROPIC_CUSTOM_HEADERS };
}

/**
 * Returns the plan for the Claude Code gateway. `authText` is the text of the auth file, or
 * `undefined` when that file does not exist. `settingsText` is the text of the Claude Code
 * settings file, or `undefined` when it does not exist. The plan is `none` without an auth file,
 * `ready` when the settings already hold the token, and `setup` otherwise.
 */
export function planGateway(
  authText: string | undefined,
  settingsText: string | undefined,
): GatewayPlan {
  if (authText === undefined) return { kind: "none" };
  const { token } = authSchema.parse(JSON.parse(authText));
  const settings: unknown = settingsText === undefined ? undefined : JSON.parse(settingsText);
  return gatewayEnvIn(settings, token) === undefined
    ? { kind: "setup", command: [...setupCommand, token] }
    : { kind: "ready" };
}
