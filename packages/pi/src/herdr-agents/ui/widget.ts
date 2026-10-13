import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import type { Subagent, SubagentProvider } from "../provider.ts";
import { renderAgentRows } from "./rows.ts";

const SPIN_MS = 80;

const TICK_MS = 1000;

/** The data that the widget needs to get the subagents and to draw them. */
export interface AgentsWidgetOptions {
  provider: Pick<SubagentProvider, "list" | "subscribe">;
  tui: Pick<TUI, "requestRender">;
  theme: Theme;
  /** Returns the current time in milliseconds. The default is `Date.now`. */
  now?: () => number;
}

function tickMs(agents: readonly Subagent[]): number | undefined {
  if (agents.length === 0) return undefined;

  return agents.some((agent) => agent.status === "working") ? SPIN_MS : TICK_MS;
}

/**
 * Shows the subagents above the editor. It draws again when a subagent changes, and on a timer
 * while subagents exist, so that the spinners and the times move.
 */
export class AgentsWidget implements Component {
  readonly #options: AgentsWidgetOptions;
  readonly #unsubscribe: () => void;
  #timer: ReturnType<typeof setInterval> | undefined;
  #timerMs: number | undefined;

  constructor(options: AgentsWidgetOptions) {
    this.#options = options;
    this.#unsubscribe = options.provider.subscribe(() => this.#refresh());
    this.#refresh();
  }

  render(width: number): string[] {
    const { provider, theme, now = Date.now } = this.#options;

    return renderAgentRows(provider.list(), { theme, width, now: now() });
  }

  invalidate(): void {}

  dispose(): void {
    this.#unsubscribe();
    clearInterval(this.#timer);
  }

  #refresh(): void {
    this.#setTimer(tickMs(this.#options.provider.list()));
    this.#options.tui.requestRender();
  }

  #setTimer(ms: number | undefined): void {
    if (ms === this.#timerMs) return;
    clearInterval(this.#timer);
    this.#timerMs = ms;
    this.#timer = ms === undefined ? undefined : setInterval(() => this.#refresh(), ms);
  }
}
