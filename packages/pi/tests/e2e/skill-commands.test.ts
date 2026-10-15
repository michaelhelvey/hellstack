import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";

import type { ChatRequest } from "./harness/fake-model.ts";
import { PiSandbox } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

async function writeSkill(name: string): Promise<void> {
  const frontmatter = `name: ${name}\ndescription: The ${name} skill.\n`;
  const file = path.join(sandbox.agentDir, "skills", name, "SKILL.md");
  await Bun.write(file, `---\n${frontmatter}disable-model-invocation: true\n---\n\nDo ${name}.\n`);
}

beforeEach(async () => {
  sandbox = await PiSandbox.create();
  await writeSkill("jira");
  await writeSkill("other");
});

afterEach(async () => {
  await sandbox.dispose();
});

function lastPrompt(request: ChatRequest | undefined): string {
  return JSON.stringify(request?.messages.at(-1)?.content);
}

function skillBlocks(prompt: string): string[] {
  return [...prompt.matchAll(/<skill name=\\"([\w-]+)\\"/g)].map((match) => match[1] ?? "");
}

test("/name anywhere in the prompt starts the skill", async () => {
  const pi = await sandbox.startRpc();

  await pi.prompt("first /other, then /jira, not /missing");

  const request = sandbox.model.requests.at(-1);
  const prompt = lastPrompt(request);
  expect(skillBlocks(prompt)).toEqual(["other", "jira"]);
  expect(prompt).toContain("Do jira.");
  expect(prompt).toContain("</skill>\\n\\nfirst /other, then /jira, not /missing");
});

test("/skill:name still starts the skill", async () => {
  const pi = await sandbox.startRpc();

  await pi.prompt("/skill:other go");

  expect(skillBlocks(lastPrompt(sandbox.model.requests.at(-1)))).toEqual(["other"]);
});

test("the editor completes /name in the middle of the prompt", async () => {
  sandbox.model.reply({ text: "Ready." }, { text: "Done." });
  const pi = sandbox.startTui();
  await pi.waitFor("fake-1");
  await pi.submit("hello");
  await pi.waitFor("Ready.");

  pi.type("please use /ji");
  await pi.waitFor("The jira skill.");
  pi.type("\t");
  pi.type("now");
  pi.type("\r");
  for (let i = 0; i < 100 && sandbox.model.requests.length < 2; i++) await Bun.sleep(50);

  const prompt = lastPrompt(sandbox.model.requests[1]);
  expect(skillBlocks(prompt)).toEqual(["jira"]);
  expect(prompt).toContain("</skill>\\n\\nplease use /jira now");
});
