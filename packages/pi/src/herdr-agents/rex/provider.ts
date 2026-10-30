import { randomUUID } from "node:crypto";
import path from "node:path";

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
import { SUBAGENT_ENV } from "../../shared/subagent.ts";
import { slug } from "../layout.ts";
import { readSessionMessages } from "../session.ts";
import type { RexEvent, RexSubscriptionHandle } from "./client.ts";
import { type Placement, type RexApi, TabPlanner } from "./tabs.ts";

/** Options for the Rex provider. */
export interface RexProviderOptions {
  client: RexApi;
  /** The working folder of the parent agent. Subagents use it when the spec has no `cwd`. */
  cwd: string;
  /** The folder for the session files of the subagents. */
  sessionDir: string;
  /** The maximum time for a subagent to start, in milliseconds. The default is 60000. */
  startTimeoutMs?: number;
  /** The maximum time for pi to start a turn after Enter, in milliseconds. The default is 3000. */
  enterTimeoutMs?: number;
  /** Returns the current time in milliseconds. The default is `Date.now`. */
  now?: () => number;
}

interface Entry {
  agent: Subagent;
  placement: Placement;
  /** The text of the last subagent message that the provider sent as an event. */
  lastReply?: string | undefined;
}

const AnySchema = z.unknown();

/** The states that show that an agent started a turn. */
const ACTIVE_STATUSES: readonly SubagentStatus[] = ["working", "blocked"];

/** The states that pi reports when it is ready for input. */
const READY_STATUSES: readonly SubagentStatus[] = [...SETTLED_STATUSES, ...ACTIVE_STATUSES];

const ENTER_ATTEMPTS = 5;

function isSettled(status: SubagentStatus): boolean {
  return SETTLED_STATUSES.includes(status);
}

/** Makes a session file name in the form that pi uses. */
function sessionFileName(now: number): string {
  return `${new Date(now).toISOString().replace(/[:.]/g, "-")}_${randomUUID()}.jsonl`;
}

/**
 * Returns the command that starts pi in a subagent block. `PI_PROGRAM_STATUS=1` makes pi report
 * its state to Rex at once, without the support query.
 */
export function piCommand(args: readonly string[]): string[] {
  return ["env", `${SUBAGENT_ENV}=1`, "PI_PROGRAM_STATUS=1", "pi", ...args];
}

type Settings = Required<Omit<RexProviderOptions, "client">>;

/**
 * Runs each subagent as a pi agent in a Rex block. Pi reports its state with the Rex program
 * status protocol. The provider keeps its state in memory only. When the parent agent stops
 * without `dispose`, the subagents continue to run without a parent. A stopped subagent can
 * resume: a message to it starts pi again in a new block, with the same session file.
 */
export class RexSubagentProvider implements SubagentProvider {
  readonly #options: Settings;
  readonly #client: RexApi;
  readonly #tabs: TabPlanner;
  readonly #entries = new Map<string, Entry>();
  /** The closed subagents, so that a message can resume them. */
  readonly #closed = new Map<string, Subagent>();
  readonly #listeners = new Set<SubagentListener>();
  #queue: Promise<unknown> = Promise.resolve();
  #watch: RexSubscriptionHandle | undefined;

  constructor(options: RexProviderOptions) {
    const { startTimeoutMs = 60_000, enterTimeoutMs = 3000, now = Date.now } = options;
    const { cwd, sessionDir } = options;
    this.#options = { startTimeoutMs, enterTimeoutMs, now, cwd, sessionDir };
    this.#client = options.client;
    this.#tabs = new TabPlanner({ client: options.client, project: path.basename(cwd) });
  }

  /** Starts pi with the task as its first message, and waits until pi starts to work on it. */
  async start(spec: SubagentSpec): Promise<Subagent> {
    const now = this.#options.now();
    const session = path.join(this.#options.sessionDir, sessionFileName(now));
    const entry = await this.#open(spec, undefined, session, ["--", spec.task]);
    await this.#untilStatus(entry, ACTIVE_STATUSES);

    return this.#require(entry.agent.id).agent;
  }

  list(): readonly Subagent[] {
    return [...this.#entries.values()].map((entry) => entry.agent);
  }

  closed(): readonly Subagent[] {
    return [...this.#closed.values()];
  }

  get(id: string): Subagent | undefined {
    return this.#entries.get(id)?.agent;
  }

  /** Sends a message to a subagent. When the subagent is closed, it resumes it first. */
  async send(id: string, text: string): Promise<void> {
    const entry = this.#entries.get(id) ?? (await this.#resume(id));
    await this.#prompt(entry, text);
  }

  async read(id: string): Promise<SubagentReadout> {
    const agent = this.#entries.get(id)?.agent ?? this.#closed.get(id);

    if (agent === undefined) throw new Error(`No subagent has the id ${id}`);
    const session = agent.session;
    const messages = session?.kind === "path" ? await readSessionMessages(session.value) : [];

    return { agent, messages };
  }

  /** Waits for a live subagent. A closed subagent is done, so the wait returns at once. */
  wait(id: string, options?: SubagentWaitOptions): Promise<Subagent> {
    const closed = this.#entries.has(id) ? undefined : this.#closed.get(id);

    return closed ? Promise.resolve(closed) : waitForStatus(this, id, options);
  }

  /** Stops a subagent and closes its block. A message can resume it later. */
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
   * Stops the event stream, but does not stop the subagents. The subagents continue to run
   * without a parent.
   */
  release(): void {
    this.#entries.clear();
    this.#closed.clear();
    this.#watch?.close();
    this.#watch = undefined;
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

  async #resume(id: string): Promise<Entry> {
    const agent = this.#closed.get(id);

    if (agent?.session?.kind !== "path") throw new Error(`No subagent has the id ${id}`);
    this.#closed.delete(id);
    const entry = await this.#open(agent, id, agent.session.value, []);
    await this.#untilStatus(entry, READY_STATUSES);

    return entry;
  }

  /** Makes a block and starts pi in it. With an id, it resumes that subagent. */
  async #open(
    spec: SubagentSpec,
    id: string | undefined,
    session: string,
    args: string[],
  ): Promise<Entry> {
    this.#watch ??= this.#client.subscribe((event) => this.#onEvent(event));
    const command = piCommand(["--model", spec.model, "--session", session, ...args]);

    return this.#serial(() => this.#register(spec, id, session, command));
  }

  async #register(
    spec: SubagentSpec,
    resumeId: string | undefined,
    session: string,
    command: string[],
  ): Promise<Entry> {
    const id =
      resumeId ??
      subagentId(spec.title, new Set([...this.#entries.keys(), ...this.#closed.keys()]));
    const block = { label: spec.title, cwd: spec.cwd ?? this.#options.cwd, command };
    const placement = await this.#tabs.place(slug(spec.group ?? "", "work"), block);
    const now = this.#options.now();

    const agent: Subagent = {
      ...spec,
      id,
      status: "unknown",
      session: { kind: "path", value: session },
      startedAt: now,
      statusChangedAt: now,
    };

    const entry = { agent, placement };
    this.#entries.set(id, entry);
    this.#emit({ type: "started", agent });

    return entry;
  }

  /** Waits until the subagent reports one of the states. Stops the subagent when it does not. */
  async #untilStatus(entry: Entry, until: readonly SubagentStatus[]): Promise<void> {
    const { id } = entry.agent;
    const timeoutMs = this.#options.startTimeoutMs;
    const agent = await waitForStatus(this, id, { until, timeoutMs }).catch(async (error) => {
      await this.#remove(id, true);
      throw error;
    });

    if (!this.#entries.has(id)) throw new Error(`Subagent ${id} closed before it started`);

    if (!until.includes(agent.status)) throw new Error(`Subagent ${id} did not start`);
  }

  /**
   * Pastes the text into the editor of pi and presses Enter until pi starts a turn. Pi keeps the
   * text in its editor when it gets Enter before its startup is complete, so the first Enter can
   * have no effect.
   */
  async #prompt(entry: Entry, text: string): Promise<void> {
    const { id } = entry.agent;
    await this.#input(entry, { type: "paste", payload: { text } });

    for (let attempt = 0; attempt < ENTER_ATTEMPTS; attempt++) {
      const timeoutMs = this.#options.enterTimeoutMs;
      const active = waitForStatus(this, id, { until: ACTIVE_STATUSES, timeoutMs });
      await this.#input(entry, { type: "key", payload: { key: "enter" } });
      const agent = await active.catch(() => undefined);

      if (agent && ACTIVE_STATUSES.includes(agent.status)) return;
    }

    throw new Error(`Subagent ${id} did not start to work on the message`);
  }

  async #input(entry: Entry, event: object): Promise<void> {
    const params = { block_id: entry.placement.blockId, event };
    await this.#client.call("block.event", params, AnySchema);
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

  #idOf(blockId: string): string | undefined {
    return [...this.#entries.values()].find((entry) => entry.placement.blockId === blockId)?.agent
      .id;
  }

  #onEvent(event: RexEvent): void {
    if (event.type === "window_closed") return this.#tabs.forgetTab(event.windowId);
    const id = this.#idOf(event.blockId);

    if (id === undefined) return;

    if (event.type === "status") this.#setStatus(id, event.status);
    else void this.#remove(id, false);
  }

  /**
   * Forgets a subagent and emits `stopped`. With `close`, it also closes the block, and keeps the
   * subagent as closed, so that a message can resume it. A subagent whose block closed for another
   * reason does not resume.
   */
  async #remove(id: string, close: boolean): Promise<void> {
    const entry = this.#entries.get(id);

    if (entry === undefined) return;
    this.#entries.delete(id);

    if (close) this.#closed.set(id, entry.agent);
    this.#tabs.release(entry.placement.blockId);
    this.#emit({ type: "stopped", agent: entry.agent });

    if (close) {
      const params = { block_id: entry.placement.blockId };
      await this.#client.call("block.close", params, AnySchema).catch(() => undefined);
    }
  }
}
