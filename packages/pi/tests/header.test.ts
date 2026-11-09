import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { PiSandbox } from "./pi.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

const skill = (name: string, frontmatter: string, body: string) =>
  sandbox.write(
    `.pi/agent/skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: Use ${name} for things.\n${frontmatter}---\n${body}`,
  );

beforeEach(async () => {
  sandbox = await PiSandbox.create();
  await sandbox.write("work/AGENTS.md", "x".repeat(4000));
  await sandbox.write(".pi/agent/AGENTS.md", "short global instructions");
  await skill("review", "", "y".repeat(8000));
  await skill("pr", "disable-model-invocation: true\n", "z".repeat(2000));
});

afterEach(() => sandbox.dispose());

const rows = (screen: string) =>
  screen
    .split("\n")
    .map((text) => /^ +(\S.*?) {2,}(\S+)$/.exec(text))
    .filter((match) => match !== null)
    .map(([, name = "", tokens = ""]) => [name, tokens]);

test("shows the token cost of each resource, grouped by section", async () => {
  const screen = await sandbox.screenWhen("tokens at session start");
  const names = rows(screen).map(([name]) => name);
  const tokens = Object.fromEntries(rows(screen));

  expect(names).toEqual([
    "context",
    "AGENTS.md",
    "~/.pi/agent/AGENTS.md",
    "skills · model",
    "review",
    "skills · manual · on use",
    "pr",
    "extensions",
    "pi",
    "builtin",
  ]);
  expect(tokens["AGENTS.md"]).toEqual("1.0k");
  expect(Number(tokens.review)).toBeLessThan(100);
  expect(tokens.pr).toEqual("500");
  expect(tokens.pi).toMatch(/^[1-9][\d.]*k?$/);
});
