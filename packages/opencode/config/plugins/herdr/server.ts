import type { Plugin } from "@opencode-ai/plugin";

import { type AgentState, herdrEnabled, herdrRequest } from "./client.ts";

type Event =
  ReturnType<Plugin.Context["event"]["subscribe"]> extends AsyncIterable<infer E> ? E : never;
type EventOf<K extends Event["type"]> = Extract<Event, { type: K }>;
type Handlers = { [K in Event["type"]]?: (event: EventOf<K>) => Promise<void> };

/** Keeps the state of the root session, and reports each change to herdr. */
class PaneState {
  private readonly children = new Set<string>();
  private readonly waiting = new Set<string>();
  private active: string | undefined;
  private last: string | undefined;

  private report(state: AgentState, sessionID: string | undefined): Promise<void> {
    const key = `${state}:${sessionID ?? ""}`;
    if (key === this.last) return Promise.resolve();
    this.last = key;
    return herdrRequest(
      "pane.report_agent",
      sessionID ? { state, agent_session_id: sessionID } : { state },
    );
  }

  private busyState(): AgentState {
    return this.waiting.size > 0 ? "blocked" : "working";
  }

  private settle(): Promise<void> {
    return this.active === undefined
      ? Promise.resolve()
      : this.report(this.busyState(), this.active);
  }

  addChild(sessionID: string, parentID: string | undefined): Promise<void> {
    if (parentID !== undefined) this.children.add(sessionID);
    return Promise.resolve();
  }

  removeChild(sessionID: string): Promise<void> {
    this.children.delete(sessionID);
    return Promise.resolve();
  }

  start(sessionID: string): Promise<void> {
    if (this.children.has(sessionID)) return Promise.resolve();
    this.active = sessionID;
    return this.report(this.busyState(), sessionID);
  }

  finish(sessionID: string): Promise<void> {
    const other = this.active !== undefined && this.active !== sessionID;
    if (other || this.children.has(sessionID)) return Promise.resolve();
    this.active = undefined;
    this.waiting.clear();
    return this.report("idle", sessionID);
  }

  wait(key: string): Promise<void> {
    this.waiting.add(key);
    return this.settle();
  }

  stopWait(key: string): Promise<void> {
    this.waiting.delete(key);
    return this.settle();
  }
}

function makeHandlers(state: PaneState): Handlers {
  return {
    "session.created": (e) => state.addChild(e.data.sessionID, e.data.parentID),
    "session.deleted": (e) => state.removeChild(e.data.sessionID),
    "session.execution.started": (e) => state.start(e.data.sessionID),
    "session.execution.succeeded": (e) => state.finish(e.data.sessionID),
    "session.execution.failed": (e) => state.finish(e.data.sessionID),
    "session.execution.interrupted": (e) => state.finish(e.data.sessionID),
    "permission.asked": (e) => state.wait(`permission:${e.data.id}`),
    "permission.replied": (e) => state.stopWait(`permission:${e.data.requestID}`),
    "form.created": (e) => state.wait(`form:${e.data.form.id}`),
    "form.replied": (e) => state.stopWait(`form:${e.data.id}`),
    "form.cancelled": (e) => state.stopWait(`form:${e.data.id}`),
  };
}

async function listen(context: Plugin.Context, signal: AbortSignal): Promise<void> {
  const handlers = makeHandlers(new PaneState());
  for await (const event of context.event.subscribe({ signal })) {
    const handler = handlers[event.type] as ((event: Event) => Promise<void>) | undefined;
    await handler?.(event);
  }
}

/**
 * Reports the agent state of opencode to herdr: working, blocked (on a permission or a form), or
 * idle. It replaces the plugin from `herdr integration install opencode`, which uses the opencode v1
 * plugin API and does not load in opencode v2.
 */
export default {
  id: "local.herdr-agent-state",
  setup: (context) => {
    if (!herdrEnabled()) return;
    const controller = new AbortController();
    void listen(context, controller.signal).catch(() => undefined);
    return () => controller.abort();
  },
} satisfies Plugin.Plugin;
