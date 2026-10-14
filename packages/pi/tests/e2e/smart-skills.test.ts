import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";

import { z } from "zod";

import { SKILLS_ENV } from "../../src/shared/skills-env.ts";
import type { ChatRequest } from "./harness/fake-model.ts";
import { PiSandbox, type SandboxOptions } from "./harness/sandbox.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

afterEach(async () => {
  await sandbox.dispose();
});

async function writeSkill(name: string, uses: string[] = []): Promise<void> {
  const metadata = uses.length > 0 ? `metadata:\n  uses: [${uses.join(", ")}]\n` : "";
  const frontmatter = `name: ${name}\ndescription: The ${name} skill.\n${metadata}`;
  const file = path.join(sandbox.agentDir, "skills", name, "SKILL.md");
  await Bun.write(file, `---\n${frontmatter}disable-model-invocation: true\n---\n\nDo ${name}.\n`);
}

/** Makes a sandbox with the skills `workflow` -> `jira` -> `browser`, and `other`. */
async function createSandbox(options: SandboxOptions = {}): Promise<void> {
  sandbox = await PiSandbox.create(options);
  await writeSkill("workflow", ["jira"]);
  await writeSkill("jira", ["browser", "missing"]);
  await writeSkill("browser", ["workflow"]);
  await writeSkill("other");
}

function visibleSkills(request: ChatRequest | undefined): string[] {
  const system = z.string().parse(request?.messages[0]?.content);
  return [...system.matchAll(/<name>(.+)<\/name>/g)].map((match) => match[1] ?? "").sort();
}

test("a skill that the user starts unlocks the skills that it uses, transitively", async () => {
  await createSandbox();
  const pi = await sandbox.startRpc();

  await pi.prompt("hello");
  expect(visibleSkills(sandbox.model.requests.at(-1))).toEqual([]);

  await pi.prompt("/skill:workflow go");
  expect(visibleSkills(sandbox.model.requests.at(-1))).toEqual(["browser", "jira", "workflow"]);
});

test("the unlocked skills stay when the session continues", async () => {
  await createSandbox();
  const first = await sandbox.startRpc();
  await first.prompt("/skill:jira go");
  await first.stop();
  const pi = await sandbox.startRpc("--continue");

  await pi.prompt("hello");
  expect(visibleSkills(sandbox.model.requests.at(-1))).toEqual(["browser", "jira", "workflow"]);
});

test("the unlocked skills go to the environment, so that subagents get them", async () => {
  await createSandbox({ env: { [SKILLS_ENV]: "other" } });
  const pi = await sandbox.startRpc();
  sandbox.model.callTools({ name: "bash", arguments: { command: `echo $${SKILLS_ENV}` } });

  const [result] = (await pi.prompt("/skill:browser go")).toolResults();
  expect(visibleSkills(sandbox.model.requests.at(-1))).toEqual([
    "browser",
    "jira",
    "other",
    "workflow",
  ]);
  expect(result?.text.trim().split(",").sort()).toEqual(["browser", "jira", "other", "workflow"]);
});
