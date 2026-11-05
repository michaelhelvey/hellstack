import { z } from "zod";

import { readIfExists } from "./files.ts";
import { ledgerPaths, type LedgerPaths } from "./paths.ts";

/** The thinking levels that pi accepts. */
export const thinkingSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function agentSchema(model: string, thinking: z.infer<typeof thinkingSchema>) {
  return z
    .object({ model: z.string().min(1).default(model), thinking: thinkingSchema.default(thinking) })
    .prefault({});
}

/** What the daemon does with an event: drop it, route it, or route it only when it is for the user. */
export const ruleActionSchema = z.enum(["ignore", "candidate", "mention-only"]);

/**
 * A source rule. It matches an event when each field that it sets is equal to the event field.
 * `repo` matches the `owner/repo` part of a GitHub thread key.
 */
export const ruleSchema = z.object({
  kind: z.string().optional(),
  thread: z.string().optional(),
  repo: z.string().optional(),
  action: ruleActionSchema,
});

const sourceFields = {
  default: ruleActionSchema.default("candidate"),
  rules: z.array(ruleSchema).default([]),
};

/** The config of the GitHub source. It uses `gh auth` for credentials. */
export const githubSourceSchema = z.object({
  type: z.literal("github"),
  everySeconds: z.number().positive().default(60),
  ...sourceFields,
});

/** The config of the Sentry source. `tokenEnv` names the environment variable with the token. */
export const sentrySourceSchema = z.object({
  type: z.literal("sentry"),
  everySeconds: z.number().positive().default(300),
  org: z.string().min(1),
  projects: z.array(z.string()).default([]),
  tokenEnv: z.string().min(1).default("SENTRY_AUTH_TOKEN"),
  ...sourceFields,
});

/** The config of one event source. */
export const sourceSchema = z.discriminatedUnion("type", [githubSourceSchema, sentrySourceSchema]);

/** The machine config in `config.json`. Every field has a default. */
export const configSchema = z.object({
  coordinator: agentSchema("claude-sonnet-5-5", "medium"),
  worker: agentSchema("claude-opus-5-5", "high"),
  summaryModel: z.string().min(1).default("claude-haiku-5-5"),
  staleAfterMinutes: z.number().positive().default(120),
  sources: z.array(sourceSchema).default(() => [githubSourceSchema.parse({ type: "github" })]),
});

/** The machine config. */
export type Config = z.infer<typeof configSchema>;
/** The config of one event source. */
export type SourceConfig = z.infer<typeof sourceSchema>;
/** A source rule. */
export type Rule = z.infer<typeof ruleSchema>;
/** A rule action. */
export type RuleAction = z.infer<typeof ruleActionSchema>;
/** The model and thinking level of one agent role. */
export type AgentConfig = Config["worker"];

/** Returns the config with all defaults. */
export function defaultConfig(): Config {
  return configSchema.parse({});
}

/** Parses the text of `config.json`. Throws an error that names the bad fields when it is not valid. */
export function parseConfig(text: string): Config {
  const result = configSchema.safeParse(JSON.parse(text));
  if (!result.success)
    throw new Error(`config.json is not valid: ${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * Reads `config.json` of the ledger. Returns the defaults when the file does not exist. Throws when
 * the file is not valid; the caller keeps its last good config.
 */
export async function loadConfig(paths: LedgerPaths = ledgerPaths()): Promise<Config> {
  const text = await readIfExists(paths.config);
  return text === undefined ? defaultConfig() : parseConfig(text);
}
