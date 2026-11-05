import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";

import {
  defaultConfig,
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
  tick,
  type DaemonOptions,
} from "../../src/daemon/daemon.ts";
import type { Source } from "../../src/daemon/source.ts";
import { statePath } from "../../src/daemon/state.ts";
import { STUCK_MS } from "../../src/daemon/watchdog.ts";
import { tempLedger } from "../core/helpers.ts";
import { event, fakeHc, noHerdr, task, terminal } from "./helpers.ts";

function failing(): Promise<CommandResult> {
  return Promise.reject(new Error("no model"));
}

const events: FactoryEvent[] = [
  event({ id: "owned" }),
  event({ id: "free", thread: "gh:acme/api#1" }),
  event({ id: "noise", kind: "ci" }),
];

async function writeLedger(paths: LedgerPaths): Promise<void> {
  const github = { type: "github", everySeconds: 60, rules: [{ kind: "ci", action: "ignore" }] };
  await writeFile(paths.config, JSON.stringify({ ...defaultConfig(), sources: [github] }));
  const owner = task({ status: "working", threads: ["gh:acme/api#88"], repo: paths.home });
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
}

async function setup(fields: Setup) {
  const paths = await tempLedger();
  await writeLedger(paths);
  const fake = fakeHc(fields.terminals ?? [terminal()], fields.detail);
  const { source, polls } = countingSource();
  const logs: string[] = [];
  const options = { paths, agents: fields.agents, hc: fake.hc, herdr: noHerdr, tickMs: 1 };
  const daemon = await createDaemon({
    ...options,
    ...{ runner: failing, createSource: () => source, log: (line) => logs.push(line) },
  } satisfies DaemonOptions);
  return { paths, fake, logs, polls, daemon };
}

async function sources(paths: LedgerPaths) {
  return (await readFeed(50, paths)).map((record) => [record.source, record.summary]);
}

describe("daemon tick", () => {
  test("routes owned events to the worker, others to the inbox and the coordinator", async () => {
    const { paths, fake, daemon } = await setup({ agents: true });
    await tick(daemon, 0);
    expect(fake.sent.map((s) => s.to)).toEqual(["factory-t-7f3a", "factory"]);
    expect(fake.sent[0]?.text).toContain("- event owned gh:acme/api#88 pr_comment");
    expect(fake.sent[1]?.text).toContain("- event free gh:acme/api#1 pr_comment");
    expect((await listInbox(paths)).map((e) => e.id)).toEqual(["free"]);
    const record = (await readFeed(10, paths)).find((r) => r.source === "github");
    expect(record).toMatchObject({
      ok: true,
      new: 3,
      ignored: 1,
      routed: [
        { thread: "gh:acme/api#88", kind: "pr_comment", to: "factory-t-7f3a" },
        { thread: "gh:acme/api#1", kind: "pr_comment", to: "inbox" },
      ],
    });
    expect(daemon.state.cursors.github).toEqual({ since: "x" });
  });

  test("waits for the poll interval and does not handle an event two times", async () => {
    const { paths, daemon, polls } = await setup({ agents: false });
    await tick(daemon, 0);
    await tick(daemon, 89_000);
    expect(polls()).toBe(1);
    await tick(daemon, 90_000);
    expect(polls()).toBe(2);
    const github = (await readFeed(50, paths)).filter((record) => record.source === "github");
    expect(github.map((record) => record.new)).toEqual([3, 0]);
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
    expect(again.digest.lines.map((line) => line.split(" ")[2])).toEqual(["owned", "free"]);
    expect((await readFeed(50, paths)).some((r) => r.error === "the coordinator is gone")).toBe(
      true,
    );
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
