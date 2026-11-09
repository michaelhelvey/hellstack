import { Option, Schema } from "effect";
import { LABELS, nameOf } from "./agents.ts";
import {
  FinishedData,
  type HcEvent,
  type Report,
  StatusData,
  Terminal,
  TurnData,
} from "./protocol.ts";

/** Something that happened to a subagent, for its parent. */
export interface News {
  readonly name: string;
  readonly address: string;
  /** `done`, `stuck`, or `progress` for a report, else what happened. */
  readonly event: "done" | "stuck" | "progress" | "idle" | "blocked" | "error" | "exited";
  readonly text: string;
}

/** What the parent knows about one of its subagents. */
interface Child {
  readonly name: string;
  readonly address: string;
  /** True while the parent waits for a report or the end of a turn. */
  busy: boolean;
  /** The last status word of the subagent. */
  state: string;
  /** The start of the last report. */
  last: string;
}

const decode = <A>(schema: Schema.Decoder<A>, data: unknown) =>
  Schema.decodeUnknownOption(schema)(data);

const noop = () => {};

/** The turn states that end a turn normally. */
const ENDED = new Set(["done", "idle"]);

const newChild = (terminal: Terminal, busy: boolean): Child => ({
  name: nameOf(terminal),
  address: terminal.address,
  busy,
  state: terminal.status?.state ?? "starting",
  last: "",
});

const isWorking = (terminal: Terminal) => terminal.status?.state === "working";

const wordOf = (data: typeof StatusData.Type) => ({ state: "none", msg: "", ...data.status });

const firstLine = (text: string) => text.split("\n")[0]?.slice(0, 80) ?? "";

const reportText = (report: Report) =>
  report.file ? `${report.summary}\n\nFull report: ${report.file}` : report.summary;

const exitText = (data: typeof FinishedData.Type) =>
  `It exited (code ${data.exit_code ?? "none"}, ${data.reason ?? "no reason"}).`;

const childLine = (child: Child) =>
  `${child.name} (${child.address}): ${child.state}${child.busy ? ", busy" : ""}${child.last ? ` - ${child.last}` : ""}`;

/** Formats news as a message for the model. */
export const formatNews = (news: News) =>
  `<subagent name="${news.name}" address="${news.address}" event="${news.event}">\n${news.text}\n</subagent>`;

/**
 * The subagents of one parent, and the news about them. `deliver` gets each news item that no
 * `next` call waits for. `changed` runs after each change, for example to draw a widget.
 */
export class Inbox {
  readonly #children = new Map<string, Child>();
  readonly #stopping = new Set<string>();
  #waiters: Array<(news: ReadonlyArray<News>) => void> = [];

  constructor(
    readonly parent: string,
    private readonly deliver: (news: News) => void,
    private readonly changed: () => void = noop,
  ) {}

  /** Adds a subagent of this parent that is not known yet. `busy`: it starts with a task. */
  track(terminal: Terminal, busy: boolean): void {
    if (terminal.labels[LABELS.parent] !== this.parent || this.has(terminal.address)) return;
    this.#children.set(terminal.address, newChild(terminal, busy));
    this.changed();
  }

  /** Replaces the list of subagents with the live terminals from hc. */
  sync(terminals: ReadonlyArray<Terminal>): void {
    const live = new Set(terminals.map((t) => t.address));
    for (const gone of [...this.#children.keys()].filter((a) => !live.has(a)))
      this.#children.delete(gone);
    for (const terminal of terminals) this.track(terminal, isWorking(terminal));
    this.changed();
  }

  /** Marks the subagent busy, for example after a message to it. */
  markBusy(address: string): void {
    Option.map(this.#child(address), (child) => (child.busy = true));
  }

  /** Marks the subagent as stopped by the parent, so that its exit is not news. */
  markStopping(address: string): void {
    this.#stopping.add(address);
  }

  /** The address of the subagent whose report document has the name, if it is known. */
  childForDoc(name: string): Option.Option<string> {
    const prefix = `r-${this.parent}-`;
    const address = name.slice(prefix.length);
    return name.startsWith(prefix) && this.has(address) ? Option.some(address) : Option.none();
  }

  /** True when the subagent with the address is known. */
  has(address: string): boolean {
    return this.#children.has(address);
  }

  /** True when the parent waits for one or more subagents. */
  anyBusy(): boolean {
    return [...this.#children.values()].some((child) => child.busy);
  }

  /** One line for each subagent: its name, address, status, and last report. */
  lines(): Array<string> {
    return [...this.#children.values()].map(childLine);
  }

  /** Applies a report from a subagent. */
  report(address: string, report: Report): void {
    Option.map(this.#child(address), (child) => {
      child.busy = child.busy && report.status === "progress";
      child.last = firstLine(report.summary);
      this.#emit(child, report.status, reportText(report));
    });
  }

  /** Applies a fact change from hc. Events about other terminals do nothing. */
  apply(event: HcEvent): void {
    (this.#events[event.type] ?? noop)(event);
  }

  /** Waits for the next news, until the timeout or the signal. Gives the news, or none. */
  next(timeoutMs: number, signal?: AbortSignal): Promise<ReadonlyArray<News>> {
    return new Promise((resolve) => {
      const done = (news: ReadonlyArray<News>) => {
        clearTimeout(timer);
        this.#waiters = this.#waiters.filter((w) => w !== done);
        resolve(news);
      };
      const timer = setTimeout(() => done([]), timeoutMs);
      signal?.addEventListener("abort", () => done([]), { once: true });
      this.#waiters.push(done);
    });
  }

  #child(address: string | undefined): Option.Option<Child> {
    return Option.fromNullishOr(this.#children.get(address ?? ""));
  }

  #on<A>(schema: Schema.Decoder<A>, handle: (child: Child, data: A) => void) {
    return (event: HcEvent) =>
      Option.map(
        Option.all([this.#child(event.terminal), decode(schema, event.data)]),
        ([child, data]) => handle(child, data),
      );
  }

  readonly #events: Readonly<Record<string, (event: HcEvent) => void>> = {
    created: (event) => Option.map(decode(Terminal, event.data), (t) => this.track(t, true)),
    status: this.#on(StatusData, (child, data) => this.#status(child, data)),
    turn: this.#on(TurnData, (child, data) => this.#turn(child, data.state)),
    finished: this.#on(FinishedData, (child, data) => this.#finished(child, data)),
  };

  #status(child: Child, data: typeof StatusData.Type): void {
    const word = wordOf(data);
    if (word.state === child.state) return;
    child.state = word.state;
    (this.#onState[word.state] ?? noop)(child, word.msg);
    this.changed();
  }

  readonly #onState: Readonly<Record<string, (child: Child, msg: string) => void>> = {
    working: (child) => {
      child.busy = true;
    },
    blocked: (child, msg) => {
      child.busy = false;
      this.#emit(child, "blocked", `It is blocked: ${msg}. Read its screen with agent_read.`);
    },
    error: (child, msg) => {
      child.busy = false;
      this.#emit(child, "error", `It reports an error: ${msg}. Read its screen with agent_read.`);
    },
  };

  #turn(child: Child, state: string): void {
    if (!child.busy || !ENDED.has(state)) return;
    child.busy = false;
    this.#emit(
      child,
      "idle",
      "It ended its turn without a report. Read its screen with agent_read.",
    );
  }

  #finished(child: Child, data: typeof FinishedData.Type): void {
    this.#children.delete(child.address);
    if (!this.#stopping.delete(child.address)) this.#emit(child, "exited", exitText(data));
    this.changed();
  }

  #emit(child: Child, event: News["event"], text: string): void {
    const news: News = { name: child.name, address: child.address, event, text };
    const waiter = this.#waiters[0];
    if (waiter) waiter([news]);
    else this.deliver(news);
    this.changed();
  }
}
