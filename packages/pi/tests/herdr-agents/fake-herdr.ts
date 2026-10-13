import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

/** One request that the fake herdr server got. */
export interface HerdrRequest {
  method: string;
  params: Record<string, unknown>;
}

const RequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});

const SubscriptionSchema = z.object({ type: z.string(), pane_id: z.string().optional() });

const SubscribeParamsSchema = z.object({ subscriptions: z.array(SubscriptionSchema) });

type Subscription = z.infer<typeof SubscriptionSchema>;

interface Subscriber {
  socket: net.Socket;
  subscriptions: Subscription[];
}

/** A tab of the fake server. */
export interface FakeTab {
  label: string;
  panes: string[];
}

/** The workspace of the fake server. */
export const FAKE_WORKSPACE = "w1";

type Handler = (params: Record<string, unknown>) => unknown;

class FakeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function eventMatches(subscription: Subscription, event: string, paneId: string): boolean {
  if (subscription.type === "pane.agent_status_changed") {
    return event === "pane.agent_status_changed" && subscription.pane_id === paneId;
  }

  return subscription.type.replace(".", "_") === event;
}

/**
 * A herdr socket server for tests. It keeps tabs and panes in memory, records each request, and
 * sends events to subscribers. It does not start processes.
 */
export class FakeHerdr {
  /** The requests that the server got, in order. */
  readonly requests: HerdrRequest[] = [];
  /** The names of the agents that already exist. */
  existingAgents: string[] = [];
  /** The number of `agent.start` requests that fail with `agent_pane_busy`. */
  busyStarts = 0;
  /** The number of `agent.prompt` requests that fail with `agent_prompt_stalled`. */
  stalledPrompts = 0;
  /** The session file that `agent.get` reports for each agent. */
  sessionPath: string | undefined;
  readonly #tabs = new Map<string, FakeTab>();
  readonly #subscribers: Subscriber[] = [];
  #nextId = 1;

  private constructor(
    readonly dir: string,
    readonly server: net.Server,
  ) {}

  /** Starts a server on a socket in a new temporary folder. */
  static async start(): Promise<FakeHerdr> {
    const dir = await mkdtemp(path.join(tmpdir(), "herdr-"));

    const fake: FakeHerdr = new FakeHerdr(
      dir,
      net.createServer((socket) => fake.#connect(socket)),
    );

    await new Promise<void>((resolve) => fake.server.listen(fake.socketPath, resolve));

    return fake;
  }

  get socketPath(): string {
    return path.join(this.dir, "herdr.sock");
  }

  /** The environment that herdr sets in a pane of the fake server. */
  get env(): Record<string, string> {
    return {
      HERDR_ENV: "1",
      HERDR_SOCKET_PATH: this.socketPath,
      HERDR_WORKSPACE_ID: FAKE_WORKSPACE,
      HERDR_PANE_ID: `${FAKE_WORKSPACE}:p0`,
    };
  }

  /** Returns the requests of one method. */
  requestsOf(method: string): HerdrRequest[] {
    return this.requests.filter((request) => request.method === method);
  }

  /** Returns the labels and panes of the open tabs. */
  tabs(): FakeTab[] {
    return [...this.#tabs.values()];
  }

  /** Sends a status change of a pane to the subscribers. */
  setStatus(paneId: string, status: string): void {
    const data = { pane_id: paneId, workspace_id: FAKE_WORKSPACE, agent_status: status };
    this.#emit("pane.agent_status_changed", paneId, data);
  }

  /** Closes a pane, as a user can do, and tells the subscribers. */
  closePane(paneId: string): void {
    for (const tab of this.#tabs.values()) tab.panes = tab.panes.filter((id) => id !== paneId);
    this.#emit("pane_closed", paneId, { pane_id: paneId, workspace_id: FAKE_WORKSPACE });
  }

  /** Stops the server and removes the temporary folder. */
  async stop(): Promise<void> {
    for (const subscriber of this.#subscribers) subscriber.socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
    await rm(this.dir, { recursive: true, force: true });
  }

  #emit(event: string, paneId: string, data: object): void {
    const line = `${JSON.stringify({ event, data })}\n`;

    for (const subscriber of this.#subscribers) {
      const wanted = subscriber.subscriptions.some((s) => eventMatches(s, event, paneId));

      if (wanted && !subscriber.socket.destroyed) subscriber.socket.write(line);
    }
  }

  #connect(socket: net.Socket): void {
    let buffer = "";
    socket.on("error", () => socket.destroy());
    socket.on("data", (data) => {
      buffer += String(data);
      const end = buffer.indexOf("\n");

      if (end >= 0) this.#handle(socket, buffer.slice(0, end));
    });
  }

  #handle(socket: net.Socket, line: string): void {
    const request = RequestSchema.parse(JSON.parse(line));
    this.requests.push({ method: request.method, params: request.params });

    if (request.method === "events.subscribe") return this.#subscribe(socket, request);

    socket.end(`${JSON.stringify({ id: request.id, ...this.#respond(request) })}\n`);
  }

  #respond(request: z.infer<typeof RequestSchema>): object {
    try {
      return { result: this.#handlers()[request.method]?.(request.params) ?? { type: "ok" } };
    } catch (error) {
      const code = error instanceof FakeError ? error.code : "internal";

      return { error: { code, message: code } };
    }
  }

  #subscribe(socket: net.Socket, request: z.infer<typeof RequestSchema>): void {
    const { subscriptions } = SubscribeParamsSchema.parse(request.params);
    this.#subscribers.push({ socket, subscriptions });
    socket.write(
      `${JSON.stringify({ id: request.id, result: { type: "subscription_started" } })}\n`,
    );
  }

  #newPane(tabId: string): string {
    const paneId = `${FAKE_WORKSPACE}:p${this.#nextId++}`;
    this.#tabs.get(tabId)?.panes.push(paneId);

    return paneId;
  }

  #tabOf(paneId: unknown): string {
    const entry = [...this.#tabs.entries()].find(([, tab]) => tab.panes.includes(String(paneId)));

    if (entry === undefined) throw new FakeError("pane_not_found");

    return entry[0];
  }

  #handlers(): Record<string, Handler> {
    return {
      "agent.list": () => ({ agents: this.existingAgents.map((name) => ({ name })) }),
      "tab.list": () => ({ tabs: this.tabs().map(({ label }) => ({ label })) }),
      "tab.create": (params) => this.#createTab(String(params.label)),
      "pane.layout": (params) => this.#layout(params.pane_id),
      "pane.split": (params) => ({
        pane: { pane_id: this.#newPane(this.#tabOf(params.target_pane_id)) },
      }),
      "agent.start": () => this.#countdown("busyStarts", "agent_pane_busy"),
      "agent.prompt": () => this.#countdown("stalledPrompts", "agent_prompt_stalled"),
      "agent.get": () => ({ agent: this.#agentInfo() }),
      "agent.wait": () => ({ agent: this.#agentInfo() }),
      "pane.close": (params) => this.closePane(String(params.pane_id)),
      "tab.close": (params) => void this.#tabs.delete(String(params.tab_id)),
    };
  }

  #createTab(label: string): object {
    const tabId = `${FAKE_WORKSPACE}:t${this.#nextId++}`;
    this.#tabs.set(tabId, { label, panes: [] });
    const paneId = this.#newPane(tabId);

    return { tab: { tab_id: tabId, label }, root_pane: { pane_id: paneId } };
  }

  #layout(paneId: unknown): object {
    const panes = this.#tabs.get(this.#tabOf(paneId))?.panes ?? [];
    const rect = { width: 100, height: 40 };

    return { layout: { panes: panes.map((id) => ({ pane_id: id, rect })) } };
  }

  #countdown(field: "busyStarts" | "stalledPrompts", code: string): undefined {
    if (this[field] <= 0) return undefined;
    this[field]--;
    throw new FakeError(code);
  }

  #agentInfo(): object {
    const session = this.sessionPath ? { kind: "path", value: this.sessionPath } : null;

    return { agent_status: "idle", launch_pending: false, agent_session: session };
  }
}
