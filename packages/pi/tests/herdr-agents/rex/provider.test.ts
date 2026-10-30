import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { MAX_AGENTS_PER_TAB } from "../../../src/herdr-agents/layout.ts";
import type { SubagentEvent, SubagentSpec } from "../../../src/herdr-agents/provider.ts";
import { piCommand, RexSubagentProvider } from "../../../src/herdr-agents/rex/provider.ts";
import { FakeRex } from "./fake-rex.ts";

const SPEC: SubagentSpec = {
  title: "Reviewer",
  model: "claude-bridge/claude-opus-5-5",
  task: "Review the code",
  group: "Code Review",
};

let rex: FakeRex;

let dir: string;

let provider: RexSubagentProvider;

let events: SubagentEvent[];

beforeEach(async () => {
  rex = new FakeRex();
  dir = await mkdtemp(path.join(tmpdir(), "rex-provider-"));
  provider = new RexSubagentProvider({
    client: rex,
    cwd: "/work/hellstack",
    sessionDir: dir,
    startTimeoutMs: 200,
    enterTimeoutMs: 20,
  });
  events = [];
  provider.subscribe((event) => events.push(event));
});

afterEach(async () => {
  provider.release();
  await rm(dir, { recursive: true, force: true });
});

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await Bun.sleep(5);
  expect(check()).toBe(true);
}

function sessionOf(id: string): string {
  return provider.get(id)?.session?.value ?? "";
}

function blockOf(id: string): string {
  const blocks = rex.windows().flatMap((window) => window.blocks);

  return blocks.find((block) => rex.commandOf(block).includes(sessionOf(id))) ?? "";
}

async function writeReply(file: string, text: string): Promise<void> {
  const message = { role: "assistant", content: [{ type: "text", text }] };
  const entry = { type: "message", timestamp: "2026-01-01T00:00:00Z", message };
  await Bun.write(file, `${JSON.stringify(entry)}\n`);
}

test("start makes a window, starts pi with the model and the task, and waits for its turn", async () => {
  const agent = await provider.start(SPEC);

  expect(agent).toMatchObject({ id: "reviewer", status: "working", title: "Reviewer" });
  expect(rex.windows().map((window) => window.label)).toEqual(["hellstack-code-review-1"]);
  expect(rex.requestsOf("session.new_window")[0]?.params.focus).toBe(false);
  const session = sessionOf(agent.id);
  expect(path.dirname(session)).toBe(dir);
  expect(rex.commandOf(blockOf(agent.id))).toEqual(
    piCommand(["--model", SPEC.model, "--session", session, "--", SPEC.task]),
  );
});

test("start puts at most eight subagents in a window, then makes a new window", async () => {
  await Promise.all(Array.from({ length: MAX_AGENTS_PER_TAB + 1 }, () => provider.start(SPEC)));

  expect(rex.windows().map((window) => [window.label, window.blocks.length])).toEqual([
    ["hellstack-code-review-1", MAX_AGENTS_PER_TAB],
    ["hellstack-code-review-2", 1],
  ]);
  expect(rex.requestsOf("session.new_split")).toHaveLength(MAX_AGENTS_PER_TAB - 1);
});

test("start fails and closes the block when pi does not start to work", async () => {
  rex.reports = false;

  expect(await provider.start(SPEC).catch((e: unknown) => String(e))).toContain("timed out");
  expect(rex.windows()).toEqual([]);
  expect(provider.list()).toEqual([]);
});

test("a status report updates the subagent, and a settled subagent reports its reply", async () => {
  const { id } = await provider.start(SPEC);
  await writeReply(sessionOf(id), "No errors.");

  rex.setStatus(blockOf(id), "done");
  await until(() => events.some((event) => event.type === "message"));

  expect(provider.get(id)?.status).toBe("done");
  expect(events.find((event) => event.type === "message")).toMatchObject({
    message: { from: "subagent", text: "No errors." },
  });
});

test("read gives no messages before pi writes its session file", async () => {
  const { id } = await provider.start(SPEC);
  expect((await provider.read(id)).messages).toEqual([]);
});

test("send pastes the text and presses Enter again until pi starts a turn", async () => {
  const { id } = await provider.start(SPEC);
  rex.setStatus(blockOf(id), "done");
  rex.ignoredEnters = 2;

  await provider.send(id, "Now check\nthe tests");

  const inputs = rex.requestsOf("block.event").map((request) => request.params.event);
  expect(inputs).toEqual([
    { type: "paste", payload: { text: "Now check\nthe tests" } },
    { type: "key", payload: { key: "enter" } },
    { type: "key", payload: { key: "enter" } },
    { type: "key", payload: { key: "enter" } },
  ]);
  expect(provider.get(id)?.status).toBe("working");
});

test("stop closes the block, and a message resumes the session in a new block", async () => {
  const { id } = await provider.start(SPEC);
  const session = sessionOf(id);
  await provider.stop(id);
  expect(rex.windows()).toEqual([]);
  expect(provider.closed().map((agent) => agent.id)).toEqual([id]);

  await provider.send(id, "Continue");

  expect(rex.commandOf(blockOf(id))).toEqual(
    piCommand(["--model", SPEC.model, "--session", session]),
  );
  expect(rex.requestsOf("block.event")[0]?.params.event).toEqual({
    type: "paste",
    payload: { text: "Continue" },
  });
  expect(provider.closed()).toEqual([]);
  expect(rex.windows().map((window) => window.label)).toEqual(["hellstack-code-review-1"]);
});

test("a new subagent does not take the id of a closed subagent", async () => {
  await provider.stop((await provider.start(SPEC)).id);
  expect((await provider.start(SPEC)).id).toBe("reviewer-2");
});

test("a block that the user closes removes its subagent, and it does not resume", async () => {
  const { id } = await provider.start(SPEC);
  rex.closeBlock(blockOf(id));
  await until(() => provider.get(id) === undefined);

  expect(events.at(-1)).toMatchObject({ type: "stopped", agent: { id } });
  expect(provider.closed()).toEqual([]);
  expect(await provider.send(id, "Continue").catch((e: unknown) => String(e))).toContain(
    "No subagent has the id reviewer",
  );
});

test("dispose stops all subagents", async () => {
  await provider.start(SPEC);
  await provider.start(SPEC);
  await provider.dispose();
  expect(rex.requestsOf("block.close")).toHaveLength(2);
  expect(rex.windows()).toEqual([]);
});
