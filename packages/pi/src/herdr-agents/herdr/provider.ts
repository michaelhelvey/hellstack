import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import {
  SETTLED_STATUSES,
  type Subagent,
  type SubagentEvent,
  type SubagentListener,
  type SubagentProvider,
  type SubagentReadout,
  type SubagentSpec,
  type SubagentStatus,
  type SubagentWaitOptions,
  subagentId,
  waitForStatus,
} from "../provider.ts";
import {
  AgentStatusSchema,
  type HerdrEnv,
  HerdrError,
  type HerdrEvent,
  type HerdrSubscriptionHandle,
} from "./client.ts";
import { slug } from "./layout.ts";
import { readSessionMessages } from "./session.ts";
import { type HerdrApi, type Placement, TabPlanner } from "./tabs.ts";

/**
 * The environment variable that marks a subagent. The provider sets it in each subagent pane, and
 * the extension does not add its tools when it is set.
 */
export const SUBAGENT_ENV = "HELLSTACK_SUBAGENT";

/** Options for the herdr provider. */
export interface HerdrProviderOptions {
  env: HerdrEnv;
  client: HerdrApi;
  /** The working folder of the parent agent. Subagents use it when the spec has no `cwd`. */
  cwd: string;
  /** The maximum time for a subagent to start, in milliseconds. The default is 60000. */
  startTimeoutMs?: number;
  /** The time between two checks while a subagent starts, in milliseconds. The default is 250. */
  pollMs?: number;
  /** Returns the current time in milliseconds. The default is `Date.now`. */
  now?: () => number;
}

interface Entry {
  agent: Subagent;
  placement: Placement;
  watch: HerdrSubscriptionHandle;
  /** The text of the last subagent message that the provider sent as an event. */
  lastReply?: string | undefined;
}

const AgentListSchema = z.object({
  agents: z.array(z.object({ name: z.string().nullish() }).loose()),
});

const AgentInfoSchema = z.object({
  agent: z
    .object({
      agent_status: AgentStatusSchema,
      launch_pending: z.boolean().nullish(),
      agent_session: z.object({ kind: z.enum(["path", "id"]), value: z.string() }).nullish(),
    })
    .loose(),
});

const AnySchema = z.unknown();

/** The states that show that an agent started a turn. */
const ACTIVE_STATUSES: readonly SubagentStatus[] = ["working", "blocked"];

const ACTIVITY_TIMEOUT_MS = 8000;

const ENTER_ATTEMPTS = 5;

const ENTER_TIMEOUT_MS = 3000;

/** Returns true when herdr did not see the agent start a turn. Throws other errors again. */
function isStall(error: unknown): true {
  const codes = ["agent_prompt_stalled", "timeout"];

  if (error instanceof HerdrError && codes.includes(error.code)) return true;
  throw error;
}

function isSettled(status: SubagentStatus): boolean {
  return SETTLED_STATUSES.includes(status);
}

function closedBy(event: HerdrEvent, placement: Placement): boolean {
  if (event.event === "pane_closed") return placement.paneId === event.data.pane_id;

  return event.event === "tab_closed" && placement.tabId === event.data.tab_id;
}

type Settings = Required<Pick<HerdrProviderOptions, "startTimeoutMs" | "pollMs" | "now" | "cwd">>;

/**
 * Runs each subagent as a pi agent in a herdr pane. It keeps its state in memory only. When the
 * parent agent stops without `dispose`, the subagents continue to run without a parent.
 */
export class HerdrSubagentProvider implements SubagentProvider {
  readonly #options: Settings;
  readonly #client: HerdrApi;
  readonly #tabs: TabPlanner;
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<SubagentListener>();
  #queue: Promise<unknown> = Promise.resolve();
  #closedWatch: HerdrSubscriptionHandle | undefined;

  constructor(options: HerdrProviderOptions) {
    const { startTimeoutMs = 60_000, pollMs = 250, now = Date.now, cwd } = options;
    this.#options = { startTimeoutMs, pollMs, now, cwd };
    this.#client = options.client;
    this.#tabs = new TabPlanner({
      client: options.client,
      workspaceId: options.env.workspaceId,
      project: path.basename(options.cwd),
      env: { [SUBAGENT_ENV]: "1" },
    });
  }

  async start(spec: SubagentSpec): Promise<Subagent> {
    this.#watchClosed();
    const entry = await this.#serial(() => this.#register(spec));

    try {
      await this.#launch(entry, spec);
    } catch (error) {
      await this.#remove(entry.agent.id, true);
      throw error;
    }

    return entry.agent;
  }

  list(): readonly Subagent[] {
    return [...this.#entries.values()].map((entry) => entry.agent);
  }

  get(id: string): Subagent | undefined {
    return this.#entries.get(id)?.agent;
  }

  async send(id: string, text: string): Promise<void> {
    this.#require(id);
    const wait = { until: ACTIVE_STATUSES, timeout_ms: ACTIVITY_TIMEOUT_MS };

    const stalled = await this.#client
      .call("agent.prompt", { target: id, text, wait }, AnySchema)
      .then(() => false, isStall);

    if (stalled) await this.#submitAgain(id);
    this.#setStatus(id, "working");
  }

  async read(id: string): Promise<SubagentReadout> {
    const { agent } = this.#require(id);
    const session = agent.session;
    const messages = session?.kind === "path" ? await readSessionMessages(session.value) : [];

    return { agent, messages };
  }

  wait(id: string, options?: SubagentWaitOptions): Promise<Subagent> {
    return waitForStatus(this, id, options);
  }

  async stop(id: string): Promise<void> {
    this.#require(id);
    await this.#remove(id, true);
  }

  subscribe(listener: SubagentListener): () => void {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.#entries.keys()].map((id) => this.#remove(id, true)));
    this.release();
  }

  /**
   * Stops the event connections, but does not stop the subagents. The subagents continue to run
   * without a parent.
   */
  release(): void {
    for (const entry of this.#entries.values()) entry.watch.close();
    this.#entries.clear();
    this.#closedWatch?.close();
    this.#closedWatch = undefined;
    this.#listeners.clear();
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run);
    this.#queue = next.catch(() => undefined);

    return next;
  }

  #require(id: string): Entry {
    const entry = this.#entries.get(id);

    if (entry === undefined) throw new Error(`No subagent has the id ${id}`);

    return entry;
  }

  #emit(event: SubagentEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  async #register(spec: SubagentSpec): Promise<Entry> {
    const { agents } = await this.#client.call("agent.list", {}, AgentListSchema);
    const taken = new Set([...agents.flatMap((a) => a.name ?? []), ...this.#entries.keys()]);
    const id = subagentId(spec.title, taken);
    const placement = await this.#tabs.place(slug(spec.group ?? "", "work"), this.#cwd(spec));
    const now = this.#options.now();

    const agent: Subagent = {
      ...spec,
      id,
      status: "unknown",
      startedAt: now,
      statusChangedAt: now,
    };

    const watch = this.#client.subscribe(
      [{ type: "pane.agent_status_changed", pane_id: placement.paneId }],
      (event) => this.#onEvent(id, event),
    );

    const entry = { agent, placement, watch };
    this.#entries.set(id, entry);
    this.#emit({ type: "started", agent });

    return entry;
  }

  #cwd(spec: SubagentSpec): string {
    return spec.cwd ?? this.#options.cwd;
  }

  async #launch(entry: Entry, spec: SubagentSpec): Promise<void> {
    const deadline = this.#options.now() + this.#options.startTimeoutMs;
    await this.#startAgent(entry, spec, deadline);
    await this.#waitReady(entry.agent.id, deadline);
    await this.send(entry.agent.id, spec.task);
  }

  /**
   * Presses Enter until the agent starts a turn. Pi keeps the text in its editor when it gets Enter
   * before its startup is complete, so the first Enter of a prompt can have no effect.
   */
  async #submitAgain(id: string): Promise<void> {
    const wait = { target: id, until: ACTIVE_STATUSES, timeout_ms: ENTER_TIMEOUT_MS };

    for (let attempt = 0; attempt < ENTER_ATTEMPTS; attempt++) {
      await this.#client.call("agent.send_keys", { target: id, keys: ["enter"] }, AnySchema);

      const active = await this.#client
        .call("agent.wait", wait, AnySchema)
        .then(() => true, isStall);

      if (active) return;
    }

    throw new Error(`Subagent ${id} did not start to work on the message`);
  }

  async #startAgent(entry: Entry, spec: SubagentSpec, deadline: number): Promise<void> {
    const params = {
      name: entry.agent.id,
      kind: "pi",
      pane_id: entry.placement.paneId,
      args: ["--model", spec.model],
    };

    await this.#retryWhileBusy(() => this.#client.call("agent.start", params, AnySchema), deadline);
  }

  async #retryWhileBusy(run: () => Promise<unknown>, deadline: number): Promise<void> {
    for (;;) {
      const busy = await run().then(
        () => false,
        (error: unknown) => this.#busyOrThrow(error, deadline),
      );

      if (!busy) return;
      await sleep(this.#options.pollMs);
    }
  }

  #busyOrThrow(error: unknown, deadline: number): true {
    const busy = error instanceof HerdrError && error.code === "agent_pane_busy";

    if (!busy || this.#options.now() > deadline) throw error;

    return true;
  }

  async #waitReady(id: string, deadline: number): Promise<void> {
    for (;;) {
      const { agent } = await this.#client.call("agent.get", { target: id }, AgentInfoSchema);

      if (agent.agent_session) this.#update(id, { session: agent.agent_session });

      if (agent.launch_pending !== true) return;

      if (this.#options.now() > deadline) throw new Error(`Subagent ${id} did not start in time`);
      await sleep(this.#options.pollMs);
    }
  }

  #update(id: string, change: Partial<Subagent>): void {
    const entry = this.#entries.get(id);

    if (entry) entry.agent = { ...entry.agent, ...change };
  }

  #setStatus(id: string, status: SubagentStatus): void {
    const entry = this.#entries.get(id);

    if (entry === undefined || entry.agent.status === status) return;
    const previous = entry.agent.status;
    this.#update(id, { status, statusChangedAt: this.#options.now() });
    this.#emit({ type: "status", agent: this.#require(id).agent, previous });

    if (isSettled(status) && !isSettled(previous)) void this.#reportReply(id);
  }

  async #reportReply(id: string): Promise<void> {
    const readout = await this.read(id).catch(() => undefined);
    const reply = readout?.messages.findLast((message) => message.from === "subagent");
    const entry = this.#entries.get(id);

    if (reply === undefined || entry === undefined || entry.lastReply === reply.text) return;
    entry.lastReply = reply.text;
    this.#emit({ type: "message", agent: entry.agent, message: reply });
  }

  #onEvent(id: string, event: HerdrEvent): void {
    if (event.event === "pane.agent_status_changed") this.#setStatus(id, event.data.agent_status);
  }

  #watchClosed(): void {
    this.#closedWatch ??= this.#client.subscribe(
      [{ type: "pane.closed" }, { type: "tab.closed" }],
      (event) => this.#onClosed(event),
    );
  }

  #onClosed(event: HerdrEvent): void {
    if (event.event === "tab_closed") this.#tabs.forgetTab(event.data.tab_id);

    for (const entry of this.#entries.values()) {
      if (closedBy(event, entry.placement)) void this.#remove(entry.agent.id, false);
    }
  }

  /** Forgets a subagent and emits `stopped`. With `close`, it also closes the pane. */
  async #remove(id: string, close: boolean): Promise<void> {
    const entry = this.#entries.get(id);

    if (entry === undefined) return;
    this.#entries.delete(id);
    entry.watch.close();
    const emptyTab = this.#tabs.release(entry.placement.paneId);
    this.#emit({ type: "stopped", agent: entry.agent });

    if (close) await this.#closeQuietly("pane.close", { pane_id: entry.placement.paneId });

    if (emptyTab) await this.#closeQuietly("tab.close", { tab_id: emptyTab });
  }

  async #closeQuietly(method: string, params: object): Promise<void> {
    await this.#client.call(method, params, AnySchema).catch(() => undefined);
  }
}
