import net from "node:net";

import { z } from "zod";

import { parseJsonOrUndefined } from "../../shared/json.ts";
import { SUBAGENT_STATUSES } from "../provider.ts";

/** The location of the calling pane and the herdr socket. Herdr sets these in each pane. */
export interface HerdrEnv {
  socketPath: string;
  workspaceId: string;
  paneId: string;
}

const HerdrEnvSchema = z.object({
  HERDR_ENV: z.literal("1"),
  HERDR_SOCKET_PATH: z.string().min(1),
  HERDR_WORKSPACE_ID: z.string().min(1),
  HERDR_PANE_ID: z.string().min(1),
});

/** Reads the herdr environment. Returns `undefined` when pi does not run in a herdr pane. */
export function herdrEnv(env: NodeJS.ProcessEnv = process.env): HerdrEnv | undefined {
  const parsed = HerdrEnvSchema.safeParse(env);

  if (!parsed.success) return undefined;
  const { HERDR_SOCKET_PATH, HERDR_WORKSPACE_ID, HERDR_PANE_ID } = parsed.data;

  return { socketPath: HERDR_SOCKET_PATH, workspaceId: HERDR_WORKSPACE_ID, paneId: HERDR_PANE_ID };
}

/** An error that the herdr server returned. */
export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

const ResponseSchema = z.union([
  z.object({ result: z.unknown() }),
  z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
]);

/** The agent states that herdr reports. */
export const AgentStatusSchema = z.enum(SUBAGENT_STATUSES);

/** A herdr event from a subscription. */
export const HerdrEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("pane.agent_status_changed"),
    data: z.object({ pane_id: z.string(), agent_status: AgentStatusSchema }),
  }),
  z.object({ event: z.literal("pane_closed"), data: z.object({ pane_id: z.string() }) }),
  z.object({ event: z.literal("tab_closed"), data: z.object({ tab_id: z.string() }) }),
]);

/** A herdr event that `HerdrClient.subscribe` gives to its listener. */
export type HerdrEvent = z.infer<typeof HerdrEventSchema>;

/** The herdr subscriptions that the provider uses. */
export type HerdrSubscription =
  | { type: "pane.agent_status_changed"; pane_id: string }
  | { type: "pane.closed" }
  | { type: "tab.closed" };

/** A live subscription. Call `close` to end it. */
export interface HerdrSubscriptionHandle {
  close(): void;
}

function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");

  return { lines: parts.slice(0, -1).filter((line) => line !== ""), rest: parts.at(-1) ?? "" };
}

function parseResult(line: string, method: string): unknown {
  const response = ResponseSchema.safeParse(parseJsonOrUndefined(line));

  if (!response.success)
    throw new HerdrError("bad_response", `herdr sent no valid ${method} result`);

  return resultOf(response.data);
}

function resultOf(response: z.infer<typeof ResponseSchema>): unknown {
  if ("error" in response) throw new HerdrError(response.error.code, response.error.message);

  return response.result;
}

/** Writes a request to a new connection, and returns the first line of the response. */
function exchange(socketPath: string, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";

    function finish(): void {
      socket.destroy();
      resolve(buffer.split("\n")[0] ?? "");
    }

    socket.on("connect", () => socket.write(request));
    socket.on("error", reject);
    socket.on("end", finish);
    socket.on("data", (data) => {
      buffer += String(data);

      if (buffer.includes("\n")) finish();
    });
  });
}

/**
 * Sends requests to the herdr socket API. The server answers one request on each connection, so
 * each call opens a new connection.
 */
export class HerdrClient {
  #nextId = 1;

  constructor(readonly socketPath: string) {}

  /** Sends one request, and parses the result with the schema. */
  async call<T>(method: string, params: object, schema: z.ZodType<T>): Promise<T> {
    const request = { id: `hellstack:${this.#nextId++}`, method, params };
    const line = await exchange(this.socketPath, `${JSON.stringify(request)}\n`);

    return schema.parse(parseResult(line, method));
  }

  /**
   * Subscribes to herdr events. The listener gets the events that the provider knows. It does not
   * get other events.
   */
  subscribe(
    subscriptions: readonly HerdrSubscription[],
    listener: (event: HerdrEvent) => void,
  ): HerdrSubscriptionHandle {
    const socket = net.createConnection(this.socketPath);
    let buffer = "";
    socket.on("connect", () => {
      const request = { id: `hellstack:${this.#nextId++}`, method: "events.subscribe" };
      socket.write(`${JSON.stringify({ ...request, params: { subscriptions } })}\n`);
    });
    socket.on("error", () => socket.destroy());
    socket.on("data", (data) => {
      const { lines, rest } = splitLines(buffer + String(data));
      buffer = rest;

      for (const line of lines) emitEvent(line, listener);
    });

    return { close: () => socket.destroy() };
  }
}

function emitEvent(line: string, listener: (event: HerdrEvent) => void): void {
  const event = HerdrEventSchema.safeParse(parseJsonOrUndefined(line));

  if (event.success) listener(event.data);
}
