import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createTask,
  getTask,
  handoff,
  listInbox,
  updateTask,
  writeInbox,
  writeTask,
  type HcTerminal,
  type Herdr,
  type LedgerPaths,
} from "../../src/core/index.ts";
import { designFromInbox, openTask } from "../../src/daemon/open.ts";
import { completeBody, tempFolder, tempLedger } from "../core/helpers.ts";
import { event, fakeHc, noHerdr, terminal } from "./helpers.ts";

function setup(paths: LedgerPaths, terminals: HcTerminal[] = []) {
  const fake = fakeHc(terminals);
  const focused: string[] = [];
  const herdr: Herdr = {
    ...noHerdr,
    focus: (address) => {
      focused.push(address);
      return Promise.resolve(true);
    },
  };
  return { fake, focused, deps: { hc: fake.hc, herdr, paths, pi: ["pi"] } };
}

async function taskWithStatus(paths: LedgerPaths, status: "sketch" | "ready" | "working") {
  const task = await createTask({ title: "Fix it", cwd: paths.home }, paths);
  await writeTask({ ...task, body: completeBody }, paths);
  if (status === "sketch") return task.meta.id;
  await handoff(task.meta.id, paths);
  if (status === "working") await updateTask(task.meta.id, { status }, paths);
  return task.meta.id;
}

describe("openTask", () => {
  test("starts and focuses the design agent of a sketch", async () => {
    const paths = await tempLedger();
    const id = await taskWithStatus(paths, "sketch");
    const { fake, focused, deps } = setup(paths);
    expect(await openTask(id, deps)).toEqual({ terminal: `factory-design-${id}`, started: true });
    expect(fake.calls).toContain(`run factory-design-${id}`);
    expect(focused).toEqual(["t1"]);
  });

  test("only focuses a worker that runs pi", async () => {
    const paths = await tempLedger();
    const id = await taskWithStatus(paths, "working");
    const live = terminal({ address: "t7", name: `factory-${id}` });
    const { fake, focused, deps } = setup(paths, [live]);
    expect(await openTask(id, deps)).toEqual({ terminal: `factory-${id}`, started: false });
    expect(fake.calls.filter((call) => call.startsWith("run"))).toEqual([]);
    expect(focused).toEqual(["t7"]);
  });

  test("starts a worker whose terminal is a shell", async () => {
    const paths = await tempLedger();
    const id = await taskWithStatus(paths, "working");
    const shell = terminal({ name: `factory-${id}`, agent: "zsh" });
    const { fake, deps } = setup(paths, [shell]);
    expect((await openTask(id, deps)).started).toBe(true);
    expect(fake.calls).toContain(`run factory-${id}`);
  });

  test("a ready task focuses its running design agent, else does nothing", async () => {
    const paths = await tempLedger();
    const id = await taskWithStatus(paths, "ready");
    const none = setup(paths);
    const result = await openTask(id, none.deps);
    expect(result).toMatchObject({ terminal: null, started: false });
    expect(result.message).toContain("ready and has no design agent");
    expect(none.fake.calls).toEqual([]);
    expect(none.focused).toEqual([]);
    const design = setup(paths, [terminal({ address: "t3", name: `factory-design-${id}` })]);
    expect(await openTask(id, design.deps)).toEqual({
      terminal: `factory-design-${id}`,
      started: false,
    });
    expect(design.focused).toEqual(["t3"]);
  });
});

async function ledgerWithCheckout() {
  const paths = await tempLedger();
  const root = await tempFolder();
  const repo = join(root, "acme-api");
  await mkdir(join(repo, ".git"), { recursive: true });
  const config = '[remote "origin"]\n\turl = git@github.com:acme/api.git\n';
  await writeFile(join(repo, ".git", "config"), config);
  await writeFile(paths.config, JSON.stringify({ repoRoots: [root] }));
  return { paths, repo };
}

describe("designFromInbox", () => {
  test("makes a sketch in the local checkout, removes the thread from the inbox, and starts the design agent", async () => {
    const { paths, repo } = await ledgerWithCheckout();
    await writeInbox(event({ id: "e1", thread: "gh:acme/api#88" }), paths);
    await writeInbox(event({ id: "e2", thread: "gh:acme/api#88" }), paths);
    await writeInbox(event({ id: "e3", thread: "gh:acme/api#9" }), paths);
    const { fake, focused, deps } = setup(paths);

    const designed = await designFromInbox("e1", deps);

    const task = await getTask(designed.task, paths);
    expect(task.meta).toMatchObject({
      title: "Add the router",
      cwd: repo,
      threads: ["gh:acme/api#88"],
    });
    expect(task.body).toContain("Draft from inbox event e1 (pr_comment on gh:acme/api#88)");
    expect(designed.terminal).toBe(`factory-design-${designed.task}`);
    expect(fake.calls).toContain(`run factory-design-${designed.task}`);
    expect(focused).toHaveLength(1);
    expect((await listInbox(paths)).map((item) => item.id)).toEqual(["e3"]);
  });

  test("uses the ledger folder when there is no checkout", async () => {
    const paths = await tempLedger();
    await writeInbox(event({ id: "s1", source: "sentry", thread: "sentry:acme/API-1" }), paths);
    const { deps } = setup(paths);
    const designed = await designFromInbox("s1", deps);
    expect((await getTask(designed.task, paths)).meta.cwd).toBe(paths.home);
  });
});
