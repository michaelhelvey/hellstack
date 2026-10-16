import { z } from "zod";

import { run } from "./git.ts";

/** An environment variable that a skill needs in an orb. */
export interface SecretSpec {
  /** The name in the orb. */
  name: string;
  /** A `secret` is hidden in Amp. An `env` value is safe to show, for example a URL. */
  kind: "secret" | "env";
  /** The local environment variables to read the value from, in order. */
  from: string[];
  /** The skill that needs the value. */
  skill: string;
}

/** The values that the personal skills need in an orb. The values are never in this repository. */
export const secretSpecs: SecretSpec[] = [
  {
    name: "JIRA_API_TOKEN",
    kind: "secret",
    from: ["JIRA_API_TOKEN", "JIRA_API_KEY"],
    skill: "jira",
  },
  { name: "JIRA_USER_EMAIL", kind: "env", from: ["JIRA_USER_EMAIL", "JIRA_EMAIL"], skill: "jira" },
  { name: "JIRA_BASE_URL", kind: "env", from: ["JIRA_BASE_URL"], skill: "jira" },
  { name: "JIRA_KPI_TEMPLATE", kind: "env", from: ["JIRA_KPI_TEMPLATE"], skill: "jira" },
  { name: "SENTRY_AUTH_TOKEN", kind: "secret", from: ["SENTRY_AUTH_TOKEN"], skill: "sentry-cli" },
  { name: "SENTRY_ORG", kind: "env", from: ["SENTRY_ORG"], skill: "sentry-cli" },
];

/** The environment of the process, by variable name. */
export type Env = Record<string, string | undefined>;

/** Returns the local value of a spec: the first of its `from` variables that is set. */
export function localValue(spec: SecretSpec, env: Env): string | undefined {
  return spec.from.map((name) => env[name]).find((value) => value !== undefined && value !== "");
}

const listSchema = z.array(z.object({ name: z.string() }));

/** Returns the names of the user's Amp secrets and environment variables. */
export async function userSecretNames(): Promise<Set<string>> {
  const output = await run(["amp", "secrets", "list", "--user", "--json"]);
  return new Set(listSchema.parse(JSON.parse(output)).map((entry) => entry.name));
}

/** Sets one user secret or environment variable in Amp. The value goes through standard input. */
export async function setUserSecret(spec: SecretSpec, value: string): Promise<void> {
  const command = [
    "amp",
    "secrets",
    "set",
    "--user",
    `--${spec.kind}`,
    "--data-file",
    "-",
    spec.name,
  ];
  const proc = Bun.spawn(command, { stdin: new Blob([value]), stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`amp secrets set ${spec.name} failed (${code}):\n${stderr}`);
}
