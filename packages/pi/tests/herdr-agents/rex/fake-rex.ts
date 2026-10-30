import { z } from "zod";

import type { SubagentStatus } from "../../../src/herdr-agents/provider.ts";
import type { RexEvent, RexSubscriptionHandle } from "../../../src/herdr-agents/rex/client.ts";
import type { RexApi } from "../../../src/herdr-agents/rex/tabs.ts";

/** One API call that the fake got. */
export interface RexRequest {
  method: string;
  params: Record<string, unknown>;
}

/** A window of the fake session. */
export interface FakeWindow {
  label: string;
  blocks: string[];
}

const LayoutSchema = z.object({
  block: z.object({ options: z.object({ command: z.array(z.string()) }) }),
});

type Layout = z.infer<typeof LayoutSchema>;

const InputSchema = z.object({ type: z.string() });

/**
 * An in-memory Rex session for tests. It records each call and acts like pi in each new block: pi
 * reports `idle` when it starts, `working` when it gets a task in its arguments, and `working`
 * when it gets Enter.
 */
export class FakeRex implements RexApi {
  /** The calls that the fake got, in order. */
  readonly requests: RexRequest[] = [];
  /** The number of Enter keys that pi does not act on. */
  ignoredEnters = 0;
  /** When false, pi in a new block reports no state. */
  reports = true;
  readonly #windows = new Map<string, FakeWindow>();
  readonly #commands = new Map<string, string[]>();
  readonly #listeners = new Set<(event: RexEvent) => void>();
  #nextId = 1;

  call<T>(method: string, params: object, schema: z.ZodType<T>): Promise<T> {
    const record = z.record(z.string(), z.unknown()).parse(params);
    this.requests.push({ method, params: record });

    return Promise.resolve(schema.parse(this.#handle(method, record)));
  }

  subscribe(listener: (event: RexEvent) => void): RexSubscriptionHandle {
    this.#listeners.add(listener);

    return { close: () => this.#listeners.delete(listener) };
  }

  /** Returns the calls of one method. */
  requestsOf(method: string): RexRequest[] {
    return this.requests.filter((request) => request.method === method);
  }

  /** Returns the windows, in the order of creation. */
  windows(): FakeWindow[] {
    return [...this.#windows.values()];
  }

  /** Returns the command of the block. */
  commandOf(blockId: string): string[] {
    return this.#commands.get(blockId) ?? [];
  }

  /** Reports a program state for the block. */
  setStatus(blockId: string, status: SubagentStatus): void {
    this.#emit({ type: "status", blockId, status });
  }

  /** Closes the block, as when the user closes it. */
  closeBlock(blockId: string): void {
    for (const [windowId, window] of this.#windows) {
      if (!window.blocks.includes(blockId)) continue;
      window.blocks = window.blocks.filter((id) => id !== blockId);
      this.#emit({ type: "block_closed", blockId });

      if (window.blocks.length > 0) continue;
      this.#windows.delete(windowId);
      this.#emit({ type: "window_closed", windowId });
    }
  }

  #emit(event: RexEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #handle(method: string, params: Record<string, unknown>): unknown {
    const handler = this.#handlers[method];

    if (handler === undefined) throw new Error(`The fake has no method ${method}`);

    return handler(params);
  }

  readonly #handlers: Record<string, (params: Record<string, unknown>) => unknown> = {
    "session.view": () => ({ windows: this.windows().map(({ label }) => ({ label })) }),
    "session.new_window": (params) =>
      this.#newWindow(String(params.window_label), LayoutSchema.parse(params.layout)),
    "session.new_split": (params) =>
      this.#newSplit(String(params.anchor_id), LayoutSchema.parse(params.layout)),
    "block.method": () => ({ columns: 80, rows: 24 }),
    "block.event": (params) =>
      this.#onInput(String(params.block_id), InputSchema.parse(params.event)),
    "block.close": (params) => this.closeBlock(String(params.block_id)),
  };

  #newWindow(label: string, layout: Layout): unknown {
    const windowId = `window:${this.#nextId++}`;
    this.#windows.set(windowId, { label, blocks: [] });

    return { window_id: windowId, block_ids: [this.#startBlock(windowId, layout)] };
  }

  #newSplit(anchorId: string, layout: Layout): unknown {
    const entry = [...this.#windows.entries()].find(([, w]) => w.blocks.includes(anchorId));

    if (entry === undefined) throw new Error(`No block ${anchorId}`);

    return { block_ids: [this.#startBlock(entry[0], layout)] };
  }

  #startBlock(windowId: string, layout: Layout): string {
    const blockId = `block:${this.#nextId++}`;
    this.#windows.get(windowId)?.blocks.push(blockId);
    const { command } = layout.block.options;
    this.#commands.set(blockId, command);

    if (this.reports) this.#later(blockId, command.includes("--") ? ["idle", "working"] : ["idle"]);

    return blockId;
  }

  #onInput(blockId: string, event: { type: string }): unknown {
    if (event.type !== "key") return {};

    if (this.ignoredEnters > 0) this.ignoredEnters--;
    else this.#later(blockId, ["working"]);

    return {};
  }

  #later(blockId: string, statuses: SubagentStatus[]): void {
    setTimeout(() => {
      for (const status of statuses) this.setStatus(blockId, status);
    }, 1);
  }
}
