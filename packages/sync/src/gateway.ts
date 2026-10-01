import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import type { Integration } from "./integrations.ts";

const authSchema = z.looseObject({ token: z.string().min(1) });

/** The path of the AI gateway auth file, relative to the home directory. */
export const gatewayAuthPath = join(".config", ".t4-ai-gateway", "auth.json");

/**
 * Makes the integration that sets up the AI gateway for Claude Code with the token from the
 * gateway auth file. The sync writes `~/.claude/settings.json` without the gateway config, so this
 * integration adds it again after the sync. Returns `undefined` when the auth file does not exist.
 */
export async function gatewayIntegration(home: string): Promise<Integration | undefined> {
  const text = await readFile(join(home, gatewayAuthPath), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const { token } = authSchema.parse(JSON.parse(text));
  const args = ["@transport4/ai-gateway", "setup", "claude-code", "--key"];
  return {
    name: "ai-gateway (Claude Code)",
    command: ["bunx", ...args, token],
    display: ["bunx", ...args, "<token>"].join(" "),
  };
}
