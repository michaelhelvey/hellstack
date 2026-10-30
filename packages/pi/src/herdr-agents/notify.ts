import {
  closesWhenDone,
  type Subagent,
  type SubagentEvent,
  type SubagentProvider,
  type SubagentStatus,
} from "./provider.ts";
import { agentReport } from "./tools.ts";

/** The custom message type of the subagent reports. */
export const REPORT_MESSAGE_TYPE = "herdr-agents";

/** The time to collect reports before one message goes to the parent agent, in milliseconds. */
const BATCH_MS = 1000;

/** The states that end the work of a subagent, and the line that the report adds for each. */
const FINISHED: Partial<Record<SubagentStatus, string>> = {
  done: "",
  idle: "",
  blocked:
    "\n\nThe subagent waits at an approval or question dialog in its pane. It cannot get messages until the dialog closes.",
};

/**
 * The subagents that a `subagent_wait` call waits for. The notifier does not report these
 * subagents, because the tool result gives their replies.
 */
export class AwaitedAgents {
  readonly #counts = new Map<string, number>();
  readonly #listeners = new Set<(id: string) => void>();

  /** Returns true while a wait for the subagent runs. */
  has(id: string): boolean {
    return (this.#counts.get(id) ?? 0) > 0;
  }

  /** Marks the subagents as awaited while `run` runs. */
  async during<T>(ids: readonly string[], run: () => Promise<T>): Promise<T> {
    for (const id of ids) this.#counts.set(id, (this.#counts.get(id) ?? 0) + 1);

    try {
      return await run();
    } finally {
      for (const id of ids) this.#release(id);
    }
  }

  /** Calls the listener when no wait for a subagent runs anymore. Returns a remove function. */
  onReleased(listener: (id: string) => void): () => void {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }

  #release(id: string): void {
    this.#counts.set(id, (this.#counts.get(id) ?? 1) - 1);

    if (this.has(id)) return;
    this.#counts.delete(id);

    for (const listener of this.#listeners) listener(id);
  }
}

/** The data that the notifier uses. */
export interface NotifierOptions {
  provider: Pick<SubagentProvider, "get" | "read" | "stop" | "subscribe">;
  awaited: AwaitedAgents;
  /** Gives the report text to the parent agent. */
  send: (text: string) => void;
  /** The time to collect reports, in milliseconds. The default is 1000. */
  batchMs?: number;
}

function statusNote(status: SubagentStatus): string {
  return FINISHED[status] ?? "";
}

function finishedWork(event: SubagentEvent): boolean {
  if (event.type !== "status" || event.previous !== "working") return false;

  return FINISHED[event.agent.status] !== undefined;
}

/**
 * Tells the parent agent when a subagent stops work. A subagent that changes from `working` to
 * `done`, `idle`, or `blocked` gets a report with its last reply. The notifier collects the
 * reports for a short time and sends them as one message. After the parent agent has the last
 * reply, from a report or from `subagent_wait`, the notifier closes a done subagent. A message
 * to it resumes it.
 */
export class CompletionNotifier {
  readonly #options: NotifierOptions;
  readonly #unsubscribe: () => void;
  readonly #unwatchAwaited: () => void;
  readonly #pending = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: NotifierOptions) {
    this.#options = options;
    this.#unsubscribe = options.provider.subscribe((event) => this.#onEvent(event));
    this.#unwatchAwaited = options.awaited.onReleased((id) => void this.#closeIfDone(id));
  }

  /** Stops the notifier. It does not send the reports that wait. */
  dispose(): void {
    this.#unsubscribe();
    this.#unwatchAwaited();
    clearTimeout(this.#timer);
    this.#pending.clear();
  }

  #onEvent(event: SubagentEvent): void {
    if (!finishedWork(event) || this.#options.awaited.has(event.agent.id)) return;
    this.#pending.add(event.agent.id);
    this.#schedule();
  }

  #schedule(): void {
    const { batchMs = BATCH_MS } = this.#options;
    this.#timer ??= setTimeout(() => void this.#flush(), batchMs);
  }

  async #flush(): Promise<void> {
    const ids = [...this.#pending];
    this.#pending.clear();
    this.#timer = undefined;
    const reports = await Promise.all(ids.map((id) => this.#report(id)));
    const text = reports.filter((report) => report !== "").join("\n\n");

    if (text !== "") this.#options.send(`Subagent update:\n\n${text}`);
  }

  async #report(id: string): Promise<string> {
    const agent = this.#finishedAgent(id);

    if (agent === undefined) return "";
    const report = await agentReport(this.#options.provider, agent);
    const closed = await this.#closeIfDone(id);

    return closed ? report : report + statusNote(agent.status);
  }

  /** Returns the subagent when it still exists, is not awaited, and is not at work again. */
  #finishedAgent(id: string): Subagent | undefined {
    if (this.#options.awaited.has(id)) return undefined;
    const agent = this.#options.provider.get(id);

    return agent && FINISHED[agent.status] !== undefined ? agent : undefined;
  }

  /** Closes the subagent when it is done and not kept open. Returns true when it closed. */
  async #closeIfDone(id: string): Promise<boolean> {
    const agent = this.#finishedAgent(id);

    if (!closesWhenDone(agent)) return false;

    return this.#options.provider.stop(id).then(
      () => true,
      () => false,
    );
  }
}
