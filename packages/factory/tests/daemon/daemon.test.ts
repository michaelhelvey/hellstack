import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";

import {
  defaultConfig,
  HcError,
  listInbox,
  readFeed,
  writeTask,
  type CommandResult,
  type FactoryEvent,
  type HcTerminal,
  type HcTerminalDetail,
  type LedgerPaths,
} from "../../src/core/index.ts";
import {
  createDaemon,
  HOUSEKEEPING_MS,
  PRUNE_MS,
  tick,
  type DaemonOptions,
} from "../../src/daemon/daemon.ts";
import { DIGEST_MS } from "../../src/daemon/digest.ts";
import type { Source } from "../../src/daemon/source.ts";
import { statePath } from "../../src/daemon/state.ts";
import { STUCK_MS } from "../../src/daemon/watchdog.ts";
import { tempLedger } from "../core/helpers.ts";
import { event, fakeHc, fakeInbox, noHerdr, task, terminal } from "./helpers.ts";

function failing(): Promise<CommandResult> {
  return Promise.reject(new Error("no model"));
}

const events: FactoryEvent[] = [
  event({ id: "owned" }),
  event({ id: "free", thread: "gh:acme/api#1" }),
  event({ id: "noise", kind: "ci" }),
  event({ id: "ask", thread: "gh:acme/api#2", kind: "review_requested" }),
];

async function writeLedger(paths: LedgerPaths): Promise<void> {
  const rules = [
    { kind: "ci", action: "ignore" },
    { kind: "review_requested", action: "wake" },
  ];
  const github = { type: "github", everySeconds: 60, rules };
  await writeFile(paths.config, JSON.stringify({ ...defaultConfig(), sources: [github] }));
  const owner = task({ status: "working", threads: ["gh:acme/api#88"], cwd: paths.home });
  await writeTask(owner, paths);
}

function countingSource() {
  let polls = 0;
  const source: Source = {
    poll: () => {
      polls++;
      return Promise.resolve({ events, cursor: { since: "x" }, minIntervalSeconds: 90 });
    },
  };
  return { source, polls: () => polls };
}

interface Setup {
  agents: boolean;
  terminals?: HcTerminal[];
  detail?: Partial<HcTerminalDetail>;
  done?: string[];
}

async function setup(fields: Setup) {
  const paths = await tempLedger();
  await writeLedger(paths);
  const fake = fakeHc(fields.terminals ?? [terminal()], fields.detail);
  const { source, polls } = countingSource();
  const logs: string[] = [];
  const inbox = fakeInbox(fields.done);
  const options = { paths, agents: fields.agents, hc: fake.hc, herdr: noHerdr, tickMs: 1 };
  const daemon = await createDaemon({
    ...options,
    ...{ runner: failing, createSource: () => source, log: (line) => logs.push(line) },
    inbox: inbox.sources,
  } satisfies DaemonOptions);
  return { paths, fake, logs, polls, daemon, inbox };
}

async function sources(paths: LedgerPaths) {
  return (await readFeed(50, paths)).map((record) => [record.source, record.summary]);
}

const feedRoutes = [
  { thread: "gh:acme/api#88", kind: "pr_comment", to: "factory-t-7f3a" },
  { thread: "gh:acme/api#1", kind: "pr_comment", to: "inbox" },
  { thread: "gh:acme/api#2", kind: "review_requested", to: "inbox" },
];

describe("daemon tick", () => {
  test("routes owned events to the worker, others to the inbox, and wake events to the coordinator", async () => {
    const { paths, fake, daemon } = await setup({ agents: true });
    await tick(daemon, 0);
    expect(fake.sent.map((s) => s.to)).toEqual(["factory-t-7f3a", "factory"]);
    expect(fake.sent[0]?.text).toContain("- event owned gh:acme/api#88 pr_comment");
    expect(fake.sent[1]?.text).toContain("- event ask gh:acme/api#2 review_requested");
    expect(fake.sent[1]?.text).not.toContain("- event free");
    expect((await listInbox(paths)).map((e) => e.id).sort()).toEqual(["ask", "free"]);
    const record = (await readFeed(10, paths)).find((r) => r.source === "github");
    expect(record).toMatchObject({ ok: true, new: 4, ignored: 1, routed: feedRoutes });
    expect(daemon.state.cursors.github).toEqual({ since: "x" });
  });

  test("an inbox event gets the detail of its source", async () => {
    const { paths, daemon } = await setup({ agents: false });
    await tick(daemon, 0);
    expect((await listInbox(paths)).map((e) => e.detail)).toEqual([
      { state: "open" },
      { state: "open" },
    ]);
  });

  test("waits for the poll interval and does not handle an event two times", async () => {
    const { paths, daemon, polls } = await setup({ agents: false });
    await tick(daemon, 0);
    await tick(daemon, 89_000);
    expect(polls()).toBe(1);
    await tick(daemon, 90_000);
    expect(polls()).toBe(2);
    const github = (await readFeed(50, paths)).filter((record) => record.source === "github");
    expect(github.map((record) => record.new)).toEqual([4, 0]);
    expect(github[1]?.summary).toBe("No new github events.");
  });

  test("keeps the coordinator alive", async () => {
    const { paths, fake, daemon } = await setup({ agents: true });
    await tick(daemon, 0);
    expect(fake.calls).toContain("run factory");
    expect(await sources(paths)).toContainEqual(["factoryd", "Started the coordinator again."]);
  });

  test("starts a missing worker again", async () => {
    const { fake, daemon } = await setup({
      agents: true,
      terminals: [terminal({ name: "factory", turn: 2 })],
    });
    await tick(daemon, 0);
    expect(fake.calls).toContain("run factory-t-7f3a");
    expect(fake.calls).not.toContain("run factory");
  });

  test("closes the idle worker of a landed task and writes a feed record", async () => {
    const now = Date.parse("2026-11-05T18:00:00.000Z");
    const { paths, fake, daemon } = await setup({
      agents: true,
      terminals: [terminal({ name: "factory-t-0bad", status: "done" })],
      detail: { state: "live", status_ms: now - 90 * 60_000 },
    });
    daemon.options.coordinator = false;
    const landed = { status: "landed" as const, landed_at: "2026-11-05T16:00:00.000Z" };
    await writeTask(task({ id: "t-0bad", ...landed }), paths);
    await tick(daemon, now);
    expect(fake.calls).toContain("kill factory-t-0bad");
    expect(fake.calls).toContain("rm factory-t-0bad");
    expect(fake.calls).not.toContain("run factory");
    expect(await sources(paths)).toContainEqual([
      "factoryd",
      "Closed the worker of t-0bad, landed 2 h ago.",
    ]);
  });

  test("keeps the worker of a landed task and starts the others when hc get fails", async () => {
    const { fake, daemon } = await setup({
      agents: true,
      terminals: [terminal({ name: "factory-t-0bad", status: "done" })],
    });
    daemon.options.coordinator = false;
    const get = fake.hc.get.bind(fake.hc);
    fake.hc.get = (t) =>
      t === "factory-t-0bad" ? Promise.reject(new HcError("exit", "hc is down")) : get(t);
    await writeTask(task({ id: "t-0bad", status: "landed" }), daemon.options.paths);
    await tick(daemon, Date.parse("2026-11-05T18:00:00.000Z"));
    expect(fake.calls).not.toContain("rm factory-t-0bad");
    expect(fake.calls).toContain("run factory-t-7f3a");
  });

  test("interrupts a coordinator that works on one turn for too long", async () => {
    const coordinator = terminal({ name: "factory" });
    const detail = { status: { state: "working" }, turn: 7 };
    const { paths, fake, daemon } = await setup({
      agents: true,
      terminals: [terminal(), coordinator],
      detail,
    });
    await tick(daemon, 0);
    await tick(daemon, STUCK_MS - HOUSEKEEPING_MS);
    expect(fake.calls).not.toContain("interrupt factory");
    await tick(daemon, STUCK_MS + HOUSEKEEPING_MS);
    expect(fake.calls).toContain("interrupt factory");
    expect((await sources(paths)).at(-1)?.[1]).toContain("Interrupted the coordinator");
  });

  test("without agents it only prints the messages", async () => {
    const { fake, logs, daemon } = await setup({ agents: false });
    await tick(daemon, 0);
    expect(fake.sent).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(logs.filter((line) => line.startsWith("[no-agents]"))).toHaveLength(2);
  });

  test("a bad config keeps the last good config and writes an error record", async () => {
    const { paths, daemon } = await setup({ agents: false });
    await tick(daemon, 0);
    await writeFile(paths.config, JSON.stringify({ sources: [{ type: "sentry" }] }));
    await tick(daemon, 1);
    expect(daemon.config.sources[0]?.type).toBe("github");
    const last = (await readFeed(1, paths))[0];
    expect(last).toMatchObject({ source: "factoryd", ok: false });
    expect(last?.error).toContain("sources[0].org");
  });

  test("prunes done inbox events every PRUNE_MS and writes one record per pass that removed some", async () => {
    const done: string[] = [];
    const { paths, daemon, inbox } = await setup({ agents: false, done });
    await tick(daemon, 0);
    expect(inbox.calls).toEqual(["isDone free,ask", "isDone "]);
    done.push("free");
    await tick(daemon, PRUNE_MS - 1);
    expect(await listInbox(paths)).toHaveLength(2);
    await tick(daemon, PRUNE_MS);
    expect((await listInbox(paths)).map((e) => e.id)).toEqual(["ask"]);
    await tick(daemon, 2 * PRUNE_MS);
    const pruned = (await sources(paths)).filter(([, summary]) => summary?.startsWith("Removed"));
    expect(pruned).toEqual([["factoryd", "Removed 1 done inbox events: gh:acme/api#1."]]);
  });

  test("a prune error writes a failed record and keeps the events", async () => {
    const { paths, daemon } = await setup({ agents: false });
    await tick(daemon, 0);
    daemon.options.inbox.github = {
      ...daemon.options.inbox.github,
      isDone: () => Promise.reject(new Error("gh is down")),
    };
    await tick(daemon, PRUNE_MS);
    expect(await listInbox(paths)).toHaveLength(2);
    const last = (await readFeed(5, paths)).find((record) => record.error);
    expect(last).toMatchObject({ source: "factoryd", summary: "The prune step failed." });
    expect(last?.error).toBe("github: gh is down");
  });

  test("a poll error writes a failed record", async () => {
    const { paths, daemon } = await setup({ agents: false });
    daemon.options.createSource = () => ({ poll: () => Promise.reject(new Error("HTTP 502")) });
    await tick(daemon, 0);
    const github = (await readFeed(50, paths)).find((record) => record.source === "github");
    expect(github).toMatchObject({
      ok: false,
      error: "HTTP 502",
      summary: "The github poll failed: HTTP 502.",
    });
  });

  test("messages that wait for the coordinator survive a restart", async () => {
    const { paths, fake, daemon } = await setup({ agents: true });
    fake.hc.send = () => Promise.reject(new Error("the coordinator is gone"));
    await tick(daemon, 0);
    const again = await createDaemon(daemon.options);
    expect(again.digest.lines.map((line) => line.split(" ")[2])).toEqual(["owned", "ask"]);
    expect((await readFeed(50, paths)).some((r) => r.error === "the coordinator is gone")).toBe(
      true,
    );
  });

  test("a coordinator that is still starting keeps the messages and writes no error", async () => {
    const { paths, fake, daemon } = await setup({ agents: true });
    const send = fake.hc.send.bind(fake.hc);
    let starting = true;
    fake.hc.send = (to, text) =>
      starting && to === "factory"
        ? Promise.reject(new HcError("unavailable", "t4r is still starting"))
        : send(to, text);
    await tick(daemon, 0);
    expect((await readFeed(50, paths)).filter((r) => !r.ok)).toEqual([]);
    starting = false;
    await tick(daemon, DIGEST_MS);
    expect(fake.sent.at(-1)).toMatchObject({ to: "factory" });
    expect(fake.sent.at(-1)?.text).toContain("- event ask");
  });

  test("a state file that is not valid gives an empty state and an error record", async () => {
    const { paths, daemon } = await setup({ agents: false });
    await mkdir(paths.state, { recursive: true });
    await writeFile(statePath(paths), "{not json");
    const again = await createDaemon(daemon.options);
    expect(again.state).toEqual({ cursors: {}, seen: [], notices: [], pending: [] });
    expect((await readFeed(1, paths))[0]).toMatchObject({ source: "factoryd", ok: false });
  });

  test("two sources with the same key are a bad config", async () => {
    const { paths, daemon } = await setup({ agents: false });
    await writeFile(
      paths.config,
      JSON.stringify({ sources: [{ type: "github" }, { type: "github" }] }),
    );
    await tick(daemon, 0);
    expect(daemon.config.sources).toHaveLength(1);
    expect((await readFeed(50, paths)).find((r) => !r.ok)?.error).toContain("the key github");
  });
});

describe("coordinator digest", () => {
  test("the coordinator gets wake events, events of a paused task, and notices", async () => {
    const { paths, fake, daemon } = await setup({ agents: true });
    await writeTask(task({ id: "t-9b21", status: "ready", title: "Fix x" }), paths);
    await writeTask(task({ id: "t-0bad", threads: ["gh:acme/api#1"], paused: true }), paths);
    await tick(daemon, 0);
    const text = fake.sent.find((s) => s.to === "factory")?.text ?? "";
    expect(text).toContain("- event ask gh:acme/api#2 review_requested");
    expect(text).toContain("- event free gh:acme/api#1 pr_comment");
    expect(text).toContain("(task t-0bad)");
    expect(text).toContain('- task t-9b21 is ready: "Fix x"');
  });

  test("a failed worker restart wakes the coordinator one time", async () => {
    const { fake, daemon } = await setup({
      agents: true,
      terminals: [terminal({ name: "factory", turn: 2 })],
    });
    const run = fake.hc.run.bind(fake.hc);
    fake.hc.run = (options) =>
      options.name === "factory-t-7f3a" ? Promise.reject(new Error("no cwd")) : run(options);
    await tick(daemon, 0);
    await tick(daemon, HOUSEKEEPING_MS + DIGEST_MS);
    const failed = fake.sent.filter((s) => s.text.includes("restart of its worker failed"));
    expect(failed.map((s) => s.to)).toEqual(["factory"]);
    expect(failed[0]?.text).toContain("- task t-7f3a: the restart of its worker failed: no cwd");
  });
});
