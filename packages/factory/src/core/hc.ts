import { z } from "zod";

import { runCommand, type CommandResult, type CommandRunner } from "./command.ts";

/**
 * A terminal as `hc ls` shows it. `hc ls` does not show `status_ms` (the time of the last status
 * change); `hc get` shows it.
 */
export const hcTerminalSchema = z.object({
  address: z.string(),
  name: z.string().nullish(),
  agent: z.string().nullish(),
  cwd: z.string(),
  state: z.string(),
  status: z.string().nullish(),
  status_ms: z.number().nullish(),
  turn: z.number(),
});

/** A terminal as `hc get` shows it. */
export const hcTerminalDetailSchema = z.object({
  address: z.string(),
  name: z.string().nullish(),
  argv: z.array(z.string()),
  cwd: z.string(),
  state: z.string(),
  labels: z.record(z.string(), z.string()),
  status: z.object({ app: z.string().nullish(), state: z.string() }).nullish(),
  status_ms: z.number().nullish(),
  turn: z.number(),
  exit_code: z.number().nullish(),
});

const lsSchema = z.object({ terminals: z.array(hcTerminalSchema) });
const errorSchema = z.object({ error: z.object({ kind: z.string(), message: z.string() }) });
const replySchema = z.record(z.string(), z.unknown());

/** A terminal as `hc ls` shows it. */
export type HcTerminal = z.infer<typeof hcTerminalSchema>;
/** A terminal as `hc get` shows it. */
export type HcTerminalDetail = z.infer<typeof hcTerminalDetailSchema>;

/** The options of `hc run`. The terminal always runs in the background and has no parent. */
export interface HcRunOptions {
  name: string;
  cwd: string;
  argv: string[];
  labels?: Record<string, string>;
  env?: Record<string, string>;
}

/** An error that `hc` reports. `kind` is the hc error kind, for example `not_found`. */
export class HcError extends Error {
  /** The hc error kind. */
  readonly kind: string;

  /** Makes an error of `kind` with `message`. */
  constructor(kind: string, message: string) {
    super(`hc: ${message}`);
    this.kind = kind;
  }
}

/** A thin client for the `hc` CLI. `t` is a terminal address or name. */
export interface Hc {
  /** Lists the live terminals. */
  ls(): Promise<HcTerminal[]>;
  /** Returns one terminal, or undefined when it does not exist. */
  get(t: string): Promise<HcTerminalDetail | undefined>;
  /** Starts a program in a new terminal and returns at once. */
  run(options: HcRunOptions): Promise<HcTerminal>;
  /** Pastes `text` into the terminal and presses Enter. */
  send(t: string, text: string): Promise<Record<string, unknown>>;
  /** Presses the stop key of the terminal. */
  interrupt(t: string): Promise<Record<string, unknown>>;
  /** Ends the program of the terminal. */
  kill(t: string): Promise<Record<string, unknown>>;
  /** Removes a finished terminal. */
  rm(t: string): Promise<Record<string, unknown>>;
}

/** Returns the `hc` arguments for {@link HcRunOptions}. */
export function hcRunArgs(options: HcRunOptions): string[] {
  const labels = Object.entries(options.labels ?? {}).flatMap(([k, v]) => ["--label", `${k}=${v}`]);
  const env = Object.entries(options.env ?? {}).map(([k, v]) => `${k}=${v}`);
  return [
    ...["run", "--bg", "--no-parent", "--name", options.name, "--cwd", options.cwd],
    ...labels,
    "--",
    ...(env.length > 0 ? ["env", ...env] : []),
    ...options.argv,
  ];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function hcError(command: string, result: CommandResult): HcError {
  const parsed = errorSchema.safeParse(parseJson(result.stderr));
  if (parsed.success) return new HcError(parsed.data.error.kind, parsed.data.error.message);
  return new HcError("exit", `hc ${command} exited with code ${result.code}: ${result.stderr}`);
}

function parseReply(command: string, result: CommandResult): unknown {
  if (result.code !== 0) throw hcError(command, result);
  return JSON.parse(result.stdout || "{}");
}

/** Returns an {@link Hc} that runs the `hc` CLI with `runner`. */
export function createHc(runner: CommandRunner = runCommand): Hc {
  async function call<T>(args: string[], schema: z.ZodType<T>, timeoutMs = 15_000): Promise<T> {
    const [command = "", ...rest] = args;
    const result = await runner("hc", [command, "--json", ...rest], timeoutMs);
    return schema.parse(parseReply(command, result));
  }
  async function get(t: string): Promise<HcTerminalDetail | undefined> {
    return call(["get", t], hcTerminalDetailSchema).catch((error: unknown) => {
      if (error instanceof HcError && error.kind === "not_found") return undefined;
      throw error;
    });
  }
  return {
    ls: async () => (await call(["ls"], lsSchema)).terminals,
    get,
    run: (options) => call(hcRunArgs(options), hcTerminalSchema),
    send: (t, text) => call(["send", t, "--", text], replySchema, 60_000),
    interrupt: (t) => call(["interrupt", t], replySchema, 30_000),
    kill: (t) => call(["kill", t], replySchema),
    rm: (t) => call(["rm", t], replySchema),
  };
}

/** Ends and removes terminal `name`. It does nothing when the terminal does not exist. */
export async function removeTerminal(hc: Hc, name: string): Promise<void> {
  const old = await hc.get(name);
  if (!old) return;
  if (old.state === "live") await hc.kill(name);
  await hc.rm(name);
}

/**
 * Returns true when the terminal is live and runs pi. A new terminal shows the agent `env` until
 * `env` starts pi, so `env` also counts.
 */
export function isRunningPi(terminal: HcTerminal): boolean {
  return terminal.state === "live" && (terminal.agent === "pi" || terminal.agent === "env");
}
