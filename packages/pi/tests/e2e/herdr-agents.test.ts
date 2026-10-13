import { afterEach, expect, setDefaultTimeout, test } from "bun:test";

import { NOT_IN_HERDR } from "../../src/herdr-agents/index.ts";
import { FakeHerdr } from "../herdr-agents/fake-herdr.ts";
import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

let herdr: FakeHerdr | undefined;

afterEach(async () => {
  await sandbox.dispose();
  await herdr?.stop();
  herdr = undefined;
});

async function modelRequests(count: number): Promise<void> {
  for (let i = 0; i < 100 && sandbox.model.requests.length < count; i++) await Bun.sleep(50);
}

test("/agents shows an error when pi does not run in herdr", async () => {
  sandbox = await PiSandbox.create();
  const pi = sandbox.startTui();
  await pi.waitFor("fake-1");
  await pi.submit("/agents");

  await pi.waitFor("Subagents need herdr.");
});

test("the model starts a subagent in herdr, and pi shows it above the editor", async () => {
  herdr = await FakeHerdr.start();
  sandbox = await PiSandbox.create({ env: herdr.env });
  const start = { title: "Reviewer", task: "Review the code", group: "review" };
  sandbox.model.reply({ toolCalls: [{ name: "subagent_start", arguments: start }] });
  sandbox.model.reply({ text: "Started.", delayMs: 500 });
  const pi = sandbox.startTui();
  await pi.waitFor("fake-1");
  await pi.submit("review the code with a subagent");

  await pi.waitFor("1 agent");
  await pi.waitFor(/Reviewer\s+fake\/fake-1\s+Review the code/);
  expect(herdr.requestsOf("agent.start")[0]?.params).toMatchObject({
    name: "reviewer",
    args: ["--model", "fake/fake-1"],
  });
});

test("a subagent does not get the subagent tools", async () => {
  sandbox = await PiSandbox.create({ env: { HELLSTACK_SUBAGENT: "1" } });
  const pi = await sandbox.startRpc();
  sandbox.model.reply({ text: "Hello." });
  await pi.prompt("hello");

  const tools = sandbox.model.requests[0]?.tools.map((t) => t.function.name) ?? [];
  expect(tools.filter((name) => name.startsWith("subagent_"))).toEqual([]);
  expect(await pi.stop()).toBe("");
});

test("the subagent tools fail with a clear error outside herdr", async () => {
  sandbox = await PiSandbox.create();
  const start = { title: "Reviewer", task: "Review the code", group: "review" };
  sandbox.model.reply({ toolCalls: [{ name: "subagent_start", arguments: start }] });
  sandbox.model.reply({ text: "Done." });
  const pi = await sandbox.startRpc();
  await pi.prompt("review the code with a subagent");

  expect(JSON.stringify(sandbox.model.requests[1]?.messages.at(-1))).toContain(NOT_IN_HERDR);
});

test("the parent agent wakes up when a subagent finishes its work, and the subagent closes", async () => {
  herdr = await FakeHerdr.start();
  sandbox = await PiSandbox.create({ env: herdr.env });
  const start = { title: "Reviewer", task: "Review the code", group: "review" };
  sandbox.model.reply(
    { toolCalls: [{ name: "subagent_start", arguments: start }] },
    { text: "Started." },
    { text: "The reviewer is done." },
  );
  const pi = await sandbox.startRpc();
  await pi.prompt("review the code with a subagent");
  const paneId = String(herdr.requestsOf("agent.start")[0]?.params.pane_id);
  herdr.setStatus(paneId, "done");

  await modelRequests(3);
  expect(JSON.stringify(sandbox.model.requests[2]?.messages.at(-1))).toContain(
    "## reviewer: done (Reviewer, fake/fake-1)",
  );
  expect(herdr.requestsOf("pane.close").map((r) => r.params.pane_id)).toEqual([paneId]);
});
