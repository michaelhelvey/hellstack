import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";

import { HerdrClient } from "../../../src/herdr-agents/herdr/client.ts";
import { MAX_AGENTS_PER_TAB } from "../../../src/herdr-agents/layout.ts";
import { HerdrSubagentProvider } from "../../../src/herdr-agents/herdr/provider.ts";
import { SUBAGENT_ENV } from "../../../src/shared/subagent.ts";
import type { SubagentEvent, SubagentSpec } from "../../../src/herdr-agents/provider.ts";
import { FAKE_WORKSPACE, FakeHerdr } from "../fake-herdr.ts";

const SPEC: SubagentSpec = {
  title: "Reviewer",
  model: "claude-bridge/claude-opus-5-5",
  task: "Review the code",
  group: "Code Review",
};

let herdr: FakeHerdr;

let provider: HerdrSubagentProvider;

let events: SubagentEvent[];

beforeEach(async () => {
  herdr = await FakeHerdr.start();
  provider = new HerdrSubagentProvider({
    env: { socketPath: herdr.socketPath, workspaceId: FAKE_WORKSPACE, paneId: "w1:p0" },
    client: new HerdrClient(herdr.socketPath),
    cwd: "/work/hellstack",
    pollMs: 1,
  });
  events = [];
  provider.subscribe((event) => events.push(event));
});

afterEach(async () => {
  provider.release();
  await herdr.stop();
});

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await Bun.sleep(5);
  expect(check()).toBe(true);
}

function paneOf(id: string): string {
  const request = herdr.requestsOf("agent.start").find((r) => r.params.name === id);

  return String(request?.params.pane_id);
}

test("start makes a tab, starts pi with the model, and gives it the task", async () => {
  const agent = await provider.start(SPEC);

  expect(agent).toMatchObject({ id: "reviewer", status: "working", title: "Reviewer" });
  expect(herdr.requestsOf("tab.create")[0]?.params).toEqual({
    workspace_id: FAKE_WORKSPACE,
    label: "hellstack-code-review-1",
    cwd: "/work/hellstack",
    env: { [SUBAGENT_ENV]: "1" },
    focus: false,
  });
  expect(herdr.requestsOf("agent.start")[0]?.params).toMatchObject({
    name: "reviewer",
    kind: "pi",
    args: ["--model", "claude-bridge/claude-opus-5-5"],
  });
  expect(herdr.requestsOf("agent.prompt")[0]?.params).toMatchObject({
    target: "reviewer",
    text: "Review the code",
  });
});

test("start puts at most eight subagents in a tab, then makes a new tab", async () => {
  await Promise.all(Array.from({ length: MAX_AGENTS_PER_TAB + 1 }, () => provider.start(SPEC)));

  expect(herdr.tabs().map((tab) => [tab.label, tab.panes.length])).toEqual([
    ["hellstack-code-review-1", MAX_AGENTS_PER_TAB],
    ["hellstack-code-review-2", 1],
  ]);
  expect(herdr.requestsOf("pane.split")).toHaveLength(MAX_AGENTS_PER_TAB - 1);
  expect(new Set(provider.list().map((agent) => agent.id)).size).toBe(MAX_AGENTS_PER_TAB + 1);
});

test("start uses a group of its own for another group", async () => {
  await provider.start(SPEC);
  await provider.start({ ...SPEC, group: "tests" });
  expect(herdr.tabs().map((tab) => tab.label)).toEqual([
    "hellstack-code-review-1",
    "hellstack-tests-1",
  ]);
});

test("start does not use the name of an agent that already exists in herdr", async () => {
  herdr.existingAgents = ["reviewer"];
  expect((await provider.start(SPEC)).id).toBe("reviewer-2");
});

test("start tries again while the new shell is not ready", async () => {
  herdr.busyStarts = 2;
  await provider.start(SPEC);
  expect(herdr.requestsOf("agent.start")).toHaveLength(3);
});

test("start presses Enter when pi keeps the task in its editor", async () => {
  herdr.stalledPrompts = 1;
  await provider.start(SPEC);
  expect(herdr.requestsOf("agent.send_keys")[0]?.params).toEqual({
    target: "reviewer",
    keys: ["enter"],
  });
});

test("a herdr status change updates the subagent, and a settled subagent reports its reply", async () => {
  const sessionPath = path.join(herdr.dir, "session.jsonl");
  const reply = { role: "assistant", content: [{ type: "text", text: "No errors." }] };
  await Bun.write(
    sessionPath,
    `${JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:00Z", message: reply })}\n`,
  );
  herdr.sessionPath = sessionPath;
  const { id } = await provider.start(SPEC);

  herdr.setStatus(paneOf(id), "done");
  await until(() => events.some((event) => event.type === "message"));

  expect(provider.get(id)?.status).toBe("done");
  expect(events.find((event) => event.type === "message")).toMatchObject({
    message: { from: "subagent", text: "No errors." },
  });
  expect((await provider.read(id)).messages).toHaveLength(1);
});

test("wait returns when herdr reports the state", async () => {
  const { id } = await provider.start(SPEC);
  const waiting = provider.wait(id, { until: ["blocked"], timeoutMs: 2000 });
  herdr.setStatus(paneOf(id), "blocked");
  expect((await waiting).status).toBe("blocked");
});

test("stop closes the pane, and the tab when it has no other subagents", async () => {
  const first = await provider.start(SPEC);
  const second = await provider.start(SPEC);

  await provider.stop(first.id);
  expect(herdr.requestsOf("tab.close")).toHaveLength(0);
  await provider.stop(second.id);

  expect(herdr.requestsOf("pane.close").map((r) => r.params.pane_id)).toEqual([
    paneOf(first.id),
    paneOf(second.id),
  ]);
  expect(herdr.tabs()).toEqual([]);
  expect(provider.list()).toEqual([]);
  expect(events.filter((event) => event.type === "stopped")).toHaveLength(2);
});

test("a pane that the user closes removes its subagent", async () => {
  const { id } = await provider.start(SPEC);
  herdr.closePane(paneOf(id));
  await until(() => provider.get(id) === undefined);
  expect(events.at(-1)).toMatchObject({ type: "stopped", agent: { id } });
});

test("dispose stops all subagents", async () => {
  await provider.start(SPEC);
  await provider.start(SPEC);
  await provider.dispose();
  expect(herdr.requestsOf("pane.close")).toHaveLength(2);
  expect(herdr.tabs()).toEqual([]);
});

async function closedWithSession(): Promise<string> {
  herdr.sessionPath = path.join(herdr.dir, "session.jsonl");
  await Bun.write(herdr.sessionPath, "");
  const { id } = await provider.start(SPEC);
  await provider.stop(id);

  return id;
}

test("a message to a stopped subagent resumes its session in a new pane", async () => {
  const id = await closedWithSession();
  expect(provider.closed().map((agent) => agent.id)).toEqual([id]);
  expect((await provider.wait(id)).id).toBe(id);

  await provider.send(id, "Now check the tests");

  expect(herdr.requestsOf("agent.start")[1]?.params).toMatchObject({
    name: id,
    args: ["--model", SPEC.model, "--session", herdr.sessionPath],
  });
  expect(herdr.requestsOf("agent.prompt").at(-1)?.params).toMatchObject({
    target: id,
    text: "Now check the tests",
  });
  expect(provider.get(id)?.status).toBe("working");
  expect(provider.closed()).toEqual([]);
  expect(herdr.tabs().map((tab) => tab.label)).toEqual(["hellstack-code-review-1"]);
});

test("a resumed subagent keeps its id when another herdr agent has its name", async () => {
  const id = await closedWithSession();
  herdr.existingAgents = [id];

  await provider.send(id, "Continue");

  expect(provider.get(id)).toBeDefined();
  expect(herdr.requestsOf("agent.start")[1]?.params.name).toBe(`${id}-2`);
  expect(herdr.requestsOf("agent.prompt").at(-1)?.params.target).toBe(`${id}-2`);
});

test("a new subagent does not take the id of a closed subagent", async () => {
  await closedWithSession();
  expect((await provider.start(SPEC)).id).toBe("reviewer-2");
});

test("a subagent whose pane the user closed does not resume", async () => {
  herdr.sessionPath = path.join(herdr.dir, "session.jsonl");
  const { id } = await provider.start(SPEC);
  herdr.closePane(paneOf(id));
  await until(() => provider.get(id) === undefined);

  expect(provider.closed()).toEqual([]);
  expect(await provider.send(id, "Continue").catch((e: unknown) => String(e))).toContain(
    "No subagent has the id reviewer",
  );
});

test("a stopped subagent without a session file does not resume", async () => {
  const { id } = await provider.start(SPEC);
  await provider.stop(id);
  expect(provider.closed()).toEqual([]);
});
