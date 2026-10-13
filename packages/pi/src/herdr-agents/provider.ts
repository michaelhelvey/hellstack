/** The lifecycle states of a subagent. They are the same as the herdr agent states. */
export const SUBAGENT_STATUSES = ["idle", "working", "blocked", "done", "unknown"] as const;

/**
 * The lifecycle state of a subagent. `idle` and `done` mean that the subagent is ready for input.
 * `blocked` means that the subagent waits for an approval or an answer. `unknown` means that the
 * state is not known.
 */
export type SubagentStatus = (typeof SUBAGENT_STATUSES)[number];

/** The data that the parent agent gives to start a subagent. */
export interface SubagentSpec {
  /** A short name for the subagent, for example `Reviewer`. */
  title: string;
  /** The model of the subagent, as `provider/model`. */
  model: string;
  /** The first prompt of the subagent. */
  task: string;
  /** The working folder of the subagent. The default is the folder of the parent agent. */
  cwd?: string | undefined;
  /**
   * One or two words that describe the work of the parent agent, for example `review`. The
   * provider puts subagents of the same group together.
   */
  group?: string | undefined;
}

/** The session of a subagent, for example the path of a pi session file. */
export interface SubagentSession {
  kind: "path" | "id";
  value: string;
}

/** A snapshot of one subagent. The provider replaces the snapshot when the subagent changes. */
export interface Subagent extends Readonly<SubagentSpec> {
  /** The unique name of the subagent. It matches `[a-z][a-z0-9_-]{0,31}`. */
  readonly id: string;
  readonly status: SubagentStatus;
  readonly session?: SubagentSession | undefined;
  /** The time when the subagent started, in milliseconds since the epoch. */
  readonly startedAt: number;
  /** The time of the last status change, in milliseconds since the epoch. */
  readonly statusChangedAt: number;
}

/** One message between the parent agent and a subagent. */
export interface SubagentMessage {
  from: "parent" | "subagent";
  text: string;
  /** The time of the message, in milliseconds since the epoch. */
  at: number;
}

/** The current state of a subagent and its conversation with the parent agent. */
export interface SubagentReadout {
  agent: Subagent;
  messages: readonly SubagentMessage[];
}

/** A change to a subagent. */
export type SubagentEvent =
  | { type: "started"; agent: Subagent }
  | { type: "status"; agent: Subagent; previous: SubagentStatus }
  | { type: "message"; agent: Subagent; message: SubagentMessage }
  | { type: "stopped"; agent: Subagent };

/** A function that receives subagent events. */
export type SubagentListener = (event: SubagentEvent) => void;

/** Options for `SubagentProvider.wait`. */
export interface SubagentWaitOptions {
  /** The states to wait for. The default is `idle`, `done`, and `blocked`. */
  until?: readonly SubagentStatus[] | undefined;
  /** The maximum time to wait, in milliseconds. */
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** Starts, controls, and reads subagents. */
export interface SubagentProvider {
  /** Starts a subagent and gives it its task. */
  start(spec: SubagentSpec): Promise<Subagent>;
  /** Returns the live subagents, in start order. */
  list(): readonly Subagent[];
  /** Returns one live subagent, or `undefined` if it does not exist. */
  get(id: string): Subagent | undefined;
  /** Sends a message from the parent agent to a subagent. */
  send(id: string, text: string): Promise<void>;
  /** Reads the state and the messages of a subagent. */
  read(id: string): Promise<SubagentReadout>;
  /** Waits until a subagent is in one of the states. Returns the subagent at that time. */
  wait(id: string, options?: SubagentWaitOptions): Promise<Subagent>;
  /** Stops a subagent and removes it from the list. */
  stop(id: string): Promise<void>;
  /** Calls the listener for each subagent event. Returns a function that removes the listener. */
  subscribe(listener: SubagentListener): () => void;
  /** Stops all subagents and releases the resources of the provider. */
  dispose(): Promise<void>;
}

/** The states in which a subagent can get input. `wait` uses them when `until` is not set. */
export const SETTLED_STATUSES: readonly SubagentStatus[] = ["idle", "done", "blocked"];

/** Makes a unique subagent id from a title, for example `code-reviewer` or `code-reviewer-2`. */
export function subagentId(title: string, taken: ReadonlySet<string>): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 28)
    .replace(/-+$/, "");

  const base = slug === "" ? "agent" : slug;
  let id = base;

  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

  return id;
}

function untilOf(options: SubagentWaitOptions): readonly SubagentStatus[] {
  return options.until ?? SETTLED_STATUSES;
}

function matchesWait(event: SubagentEvent, id: string, until: readonly SubagentStatus[]): boolean {
  return event.agent.id === id && (event.type === "stopped" || until.includes(event.agent.status));
}

class StatusWatch {
  readonly promise: Promise<Subagent>;
  #resolve!: (agent: Subagent) => void;
  #reject!: (error: Error) => void;
  #unsubscribe: () => void = () => undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #onAbort = (): void => this.#fail("was aborted");

  constructor(
    provider: Pick<SubagentProvider, "subscribe">,
    readonly id: string,
    readonly options: SubagentWaitOptions,
  ) {
    this.promise = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    const until = untilOf(options);
    this.#unsubscribe = provider.subscribe((event) => {
      if (matchesWait(event, id, until)) this.#settle(() => this.#resolve(event.agent));
    });

    if (options.timeoutMs)
      this.#timer = setTimeout(() => this.#fail("timed out"), options.timeoutMs);
    this.#listen(options.signal);
  }

  #listen(signal: AbortSignal | undefined): void {
    if (signal === undefined) return;

    if (signal.aborted) this.#onAbort();
    else signal.addEventListener("abort", this.#onAbort, { once: true });
  }

  #fail(reason: string): void {
    this.#settle(() => this.#reject(new Error(`Wait for ${this.id} ${reason}`)));
  }

  #settle(finish: () => void): void {
    this.#unsubscribe();
    clearTimeout(this.#timer);
    this.options.signal?.removeEventListener("abort", this.#onAbort);
    finish();
  }
}

/**
 * Waits for a subagent state with `subscribe`. It also stops the wait when the subagent stops. A
 * provider that has no native wait can use this function.
 */
export function waitForStatus(
  provider: Pick<SubagentProvider, "get" | "subscribe">,
  id: string,
  options: SubagentWaitOptions = {},
): Promise<Subagent> {
  const agent = provider.get(id);

  if (agent === undefined) return Promise.reject(new Error(`No subagent has the id ${id}`));

  if (untilOf(options).includes(agent.status)) return Promise.resolve(agent);

  return new StatusWatch(provider, id, options).promise;
}
