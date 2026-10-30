import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { z } from "zod";

import { parseJsonOrUndefined } from "../../shared/json.ts";
import type { SubagentStatus } from "../provider.ts";

/** The location of the calling pane. Rex sets these in each terminal. */
export interface RexEnv {
  sessionId: string;
  blockId: string;
}

const RexEnvSchema = z.object({
  REX_SESSION: z.string().min(1),
  REX_BLOCK: z.string().min(1),
});

/** Reads the Rex environment. Returns `undefined` when pi does not run in a Rex terminal. */
export function rexEnv(env: NodeJS.ProcessEnv = process.env): RexEnv | undefined {
  const parsed = RexEnvSchema.safeParse(env);

  if (!parsed.success) return undefined;

  return { sessionId: parsed.data.REX_SESSION, blockId: parsed.data.REX_BLOCK };
}

/** An error from a `rex` command. */
export class RexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RexError";
  }
}

/** The program states of the Rex program status protocol (OSC 7501), as subagent states. */
const PROGRAM_STATES: Record<string, SubagentStatus> = {
  idle: "idle",
  working: "working",
  blocked: "blocked",
  done: "done",
  error: "done",
};

/** A Rex event that `RexClient.subscribe` gives to its listener. */
export type RexEvent =
  | { type: "status"; blockId: string; status: SubagentStatus }
  | { type: "block_closed"; blockId: string }
  | { type: "window_closed"; windowId: string };

const ProgramStatusEventSchema = z
  .object({
    type: z.literal("block_event"),
    payload: z.object({
      block_id: z.string(),
      name: z.literal("program_status_changed"),
      payload: z.object({ id: z.literal(""), record: z.object({ state: z.string() }).loose() }),
    }),
  })
  .transform(({ payload }): RexEvent | undefined => {
    const status = PROGRAM_STATES[payload.payload.record.state];

    return status && { type: "status", blockId: payload.block_id, status };
  });

const BlockClosedSchema = z
  .object({ type: z.literal("block_closed"), payload: z.object({ block_id: z.string() }) })
  .transform(({ payload }): RexEvent => ({ type: "block_closed", blockId: payload.block_id }));

const WindowClosedSchema = z
  .object({ type: z.literal("window_closed"), payload: z.object({ window_id: z.string() }) })
  .transform(({ payload }): RexEvent => ({ type: "window_closed", windowId: payload.window_id }));

const SessionEventSchema = z.object({
  type: z.literal("session_event"),
  payload: z.object({
    event: z.union([ProgramStatusEventSchema, BlockClosedSchema, WindowClosedSchema]),
  }),
});

/** A live subscription. Call `close` to end it. */
export interface RexSubscriptionHandle {
  close(): void;
}

/** Converts one line of `rex events --json` to a `RexEvent`. Returns `undefined` for other events. */
export function parseRexEvent(line: string): RexEvent | undefined {
  return SessionEventSchema.safeParse(parseJsonOrUndefined(line)).data?.payload.event;
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("rex", args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new RexError(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

/** Calls the Rex server API of one session with the `rex` command. */
export class RexClient {
  constructor(readonly sessionId: string) {}

  /** Calls one API method, and parses the result with the schema. */
  async call<T>(method: string, params: object, schema: z.ZodType<T>): Promise<T> {
    const output = await run(["api", "call", "-s", this.sessionId, method, JSON.stringify(params)]);

    return schema.parse(parseJsonOrUndefined(output));
  }

  /** Streams the events of the session. The listener gets only the events that the provider uses. */
  subscribe(listener: (event: RexEvent) => void): RexSubscriptionHandle {
    const child = spawn("rex", ["events", "-s", this.sessionId, "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.on("error", () => undefined);
    createInterface({ input: child.stdout }).on("line", (line) => {
      const event = parseRexEvent(line);

      if (event) listener(event);
    });

    return { close: () => child.kill() };
  }
}
