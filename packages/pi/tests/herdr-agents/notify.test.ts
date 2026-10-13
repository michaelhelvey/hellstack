import { afterEach, expect, test } from "bun:test";

import { AwaitedAgents, CompletionNotifier } from "../../src/herdr-agents/notify.ts";
import type {
  Subagent,
  SubagentListener,
  SubagentProvider,
  SubagentStatus,
} from "../../src/herdr-agents/provider.ts";

type FakeProvider = Pick<SubagentProvider, "get" | "read" | "stop" | "subscribe">;

const agents = new Map<string, Subagent>();

const listeners = new Set<SubagentListener>();

const stopped: string[] = [];

const provider: FakeProvider = {
  get: (id) => agents.get(id),
  read: (id) => {
    const agent = agents.get(id);

    if (agent === undefined) return Promise.reject(new Error("stopped"));
    const message = { from: "subagent" as const, text: `${agent.title} reply`, at: 0 };

    return Promise.resolve({ agent, messages: [message] });
  },
  stop: (id) => {
    stopped.push(id);
    agents.delete(id);

    return Promise.resolve();
  },
  subscribe: (listener) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  },
};

let notifier: CompletionNotifier | undefined;

afterEach(() => {
  notifier?.dispose();
  agents.clear();
  listeners.clear();
  stopped.length = 0;
});

function change(
  id: string,
  previous: SubagentStatus,
  status: SubagentStatus,
  keepOpen = false,
): void {
  const agent: Subagent = {
    keepOpen,
    id,
    title: id.toUpperCase(),
    model: "fake/model",
    task: "Task",
    status,
    startedAt: 0,
    statusChangedAt: 0,
  };

  agents.set(id, agent);

  for (const listener of listeners) listener({ type: "status", agent, previous });
}

function start(awaited = new AwaitedAgents()): string[] {
  const sent: string[] = [];
  notifier = new CompletionNotifier({
    provider,
    awaited,
    send: (text) => sent.push(text),
    batchMs: 5,
  });

  return sent;
}

test("subagents that finish work together give one report with each reply", async () => {
  const sent = start();
  change("a", "working", "done");
  change("b", "working", "idle");
  await Bun.sleep(30);

  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("## a: done (A, fake/model)\n\nA reply");
  expect(sent[0]).toContain("## b: idle (B, fake/model)\n\nB reply");
});

test("a blocked subagent gets a report that tells about the dialog", async () => {
  const sent = start();
  change("a", "working", "blocked");
  await Bun.sleep(30);
  expect(sent[0]).toContain("approval or question dialog");
});

test("a subagent that becomes idle at startup does not give a report", async () => {
  const sent = start();
  change("a", "unknown", "idle");
  await Bun.sleep(30);
  expect(sent).toEqual([]);
});

test("a subagent that a subagent_wait call waits for does not give a report", async () => {
  const awaited = new AwaitedAgents();
  const sent = start(awaited);
  await awaited.during(["a"], async () => {
    change("a", "working", "done");
    await Bun.sleep(30);
  });
  expect(sent).toEqual([]);
});

test("a subagent that stops before the report goes does not give a report", async () => {
  const sent = start();
  change("a", "working", "done");
  agents.delete("a");
  await Bun.sleep(30);
  expect(sent).toEqual([]);
});

test("a done subagent closes after its report, and the report says so", async () => {
  const sent = start();
  change("a", "working", "done");
  await Bun.sleep(30);

  expect(stopped).toEqual(["a"]);
  expect(sent[0]).toContain("A reply\n\nThe subagent is done, so it closes now.");
});

test("a blocked subagent and a subagent that is kept open do not close", async () => {
  start();
  change("a", "working", "blocked");
  change("b", "working", "done", true);
  await Bun.sleep(30);

  expect(stopped).toEqual([]);
});

test("an awaited subagent closes when the wait for it ends", async () => {
  const awaited = new AwaitedAgents();
  start(awaited);
  await awaited.during(["a"], async () => {
    change("a", "working", "done");
    await Bun.sleep(30);
    expect(stopped).toEqual([]);
  });
  await Bun.sleep(5);

  expect(stopped).toEqual(["a"]);
});
