import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { applySkillSplit, hasSkillsCode, patchInstalledPi } from "../../scripts/patch-startup.ts";

const CHUNKS_DIR = path.join(
  import.meta.dir,
  "../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks",
);

/** Returns the pi bundle of the devDependency, as installed. */
async function bundleSource(): Promise<string> {
  const names = (await readdir(CHUNKS_DIR)).filter((name) => name.endsWith(".js"));
  const sources = await Promise.all(
    names.map((name) => readFile(path.join(CHUNKS_DIR, name), "utf8")),
  );
  const bundle = sources.find(hasSkillsCode);
  if (bundle === undefined) throw new Error("No pi bundle has the skills code. Update the patch.");
  return bundle;
}

/** Returns the code that renders the [Skills] section. */
function skillsCode(bundle: string): string {
  const start = bundle.indexOf("let skills=skillsResult.skills;");
  const end = bundle.indexOf("let templates=this.session.promptTemplates;", start);
  if (start < 0 || end < 0) throw new Error("Cannot find the skills code in the pi bundle.");
  return bundle.slice(start, end);
}

interface Skill {
  name: string;
  disableModelInvocation: boolean;
  filePath: string;
}

/** Runs the skills code with fake skills, and returns the body of the [Skills] section. */
function renderSkills(code: string, skills: Skill[]): string {
  let body: (() => string) | undefined;
  const sandbox: Record<string, unknown> = {
    skillsResult: { skills },
    formatCompactList: (names: string[]) =>
      `  ${[...names].sort((a, b) => a.localeCompare(b)).join(", ")}`,
    theme: { fg: (_color: string, text: string) => text },
    addLoadedSection: (_name: string, collapsedBody: () => string) => {
      body = collapsedBody;
    },
    buildScopeGroups: (items: unknown[]) => items,
    formatScopeGroups: () => "",
    formatDisplayPath: (filePath: string) => filePath,
    getShortPath: (filePath: string) => filePath,
  };
  runInNewContext(code, sandbox);
  return body === undefined ? "" : body();
}

/** Renders the [Skills] section of a patched pi bundle. */
async function renderBundle(skills: Skill[]): Promise<string> {
  const bundle = applySkillSplit(await bundleSource());
  return renderSkills(skillsCode(bundle), skills);
}

/** Writes `source` to a pi package folder in a temporary folder, and runs `run` on it. */
async function withPackage(
  source: string,
  run: (packageDir: string) => Promise<void>,
): Promise<void> {
  const packageDir = await mkdtemp(path.join(tmpdir(), "hellstack-patch-startup-"));
  const chunksDir = path.join(packageDir, "dist", "bundle", "chunks");
  await mkdir(chunksDir, { recursive: true });
  const file = path.join(chunksDir, "chunk.js");
  await writeFile(file, source);
  try {
    await run(packageDir);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
}

/** Runs `run` and returns the message of the error it throws. */
async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
  return "";
}

const skills: Skill[] = [
  { name: "zebra", disableModelInvocation: false, filePath: "/skills/zebra/SKILL.md" },
  { name: "jira", disableModelInvocation: true, filePath: "/skills/jira/SKILL.md" },
  { name: "beta", disableModelInvocation: false, filePath: "/skills/beta/SKILL.md" },
  { name: "show-me", disableModelInvocation: true, filePath: "/skills/show-me/SKILL.md" },
];

test("the patch puts model skills on one line and command-only skills on the next line", async () => {
  expect(await renderBundle(skills)).toBe("  beta, zebra\n  command-only: jira, show-me");
});

test("the patch leaves out the first line when all skills are command-only", async () => {
  const commandOnly = skills.filter((skill) => skill.disableModelInvocation);
  expect(await renderBundle(commandOnly)).toBe("  command-only: jira, show-me");
});

test("the patch leaves out the second line when the model can invoke all skills", async () => {
  const modelSkills = skills.filter((skill) => !skill.disableModelInvocation);
  expect(await renderBundle(modelSkills)).toBe("  beta, zebra");
});

test("the patch is idempotent", async () => {
  const bundle = applySkillSplit(await bundleSource());
  expect(applySkillSplit(bundle)).toBe(bundle);
});

test("the patch throws when the bundle does not have the skills code", () => {
  expect(() => applySkillSplit("const a = 1;")).toThrow(/Cannot find the \[Skills\] code/);
});

test("patchInstalledPi writes the patched bundle, and a second run changes nothing", async () => {
  const source = await bundleSource();
  await withPackage(source, async (packageDir) => {
    await patchInstalledPi(packageDir);
    const file = path.join(packageDir, "dist", "bundle", "chunks", "chunk.js");
    expect(await readFile(file, "utf8")).toBe(applySkillSplit(source));
    expect(await patchInstalledPi(packageDir)).toEqual([]);
  });
});

test("patchInstalledPi throws when no bundle has the skills code", async () => {
  await withPackage("const a = 1;", async (packageDir) => {
    expect(await messageOf(() => patchInstalledPi(packageDir))).toContain(
      "Cannot find the [Skills] code",
    );
  });
});
