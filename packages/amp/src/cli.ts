import { homedir } from "node:os";
import { join } from "node:path";
import { buildPluginsRepo, buildSkillsRepo, type Tree } from "./build.ts";
import { checkout, commitAndPush, discard, type RepoKind, run, stageAll } from "./git.ts";
import { mirror } from "./mirror.ts";
import {
  localValue,
  type SecretSpec,
  secretSpecs,
  setUserSecret,
  userSecretNames,
} from "./secrets.ts";

const usage = `Usage:
  bun run amp:publish [--dry-run] [--yes]   Publish the skills and the plugin to Amp
  bun run amp:secrets [--set]               Show the orb secrets, or set them from this shell`;

interface Repo {
  kind: RepoKind;
  build: () => Promise<Tree>;
}

const repos: Repo[] = [
  { kind: "skills", build: buildSkillsRepo },
  { kind: "plugins", build: buildPluginsRepo },
];

const repoRoot = join(import.meta.dir, "..", "..", "..");
const cacheDir = join(
  process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"),
  "hellstack",
  "amp",
);

async function publishMessage(): Promise<string> {
  const head = (await run(["git", "rev-parse", "--short", "HEAD"], repoRoot)).trim();
  return `Publish from hellstack ${head}`;
}

function shouldPush(repository: string, flags: Set<string>): boolean {
  if (flags.has("--yes")) return true;
  return prompt(`Push these changes to ${repository}? This publishes them. [y/N]`) === "y";
}

async function publishRepo(repo: Repo, flags: Set<string>): Promise<void> {
  const name = `user-${repo.kind}`;
  const dir = join(cacheDir, name);
  const tree = await repo.build();
  await checkout(repo.kind, dir);
  await mirror(dir, tree);
  const status = await stageAll(dir);
  console.log(`${name} (${dir}):\n${status || "no changes\n"}`);
  if (status === "" || flags.has("--dry-run")) return discard(dir);
  if (!shouldPush(name, flags)) return discard(dir);
  await commitAndPush(dir, await publishMessage());
  console.log(`pushed ${name}`);
}

async function publish(flags: Set<string>): Promise<void> {
  if (Bun.which("amp") === null) return console.log("amp is not installed, so Amp gets nothing.");
  for (const repo of repos) await publishRepo(repo, flags);
}

function secretLine(spec: SecretSpec, inShell: boolean, inAmp: boolean): string {
  const amp = inAmp ? "in Amp" : "missing";
  const shell = inShell ? "in this shell" : `not in this shell (${spec.from.join(" or ")})`;
  return `${spec.name.padEnd(20)} ${amp.padEnd(8)} ${spec.kind.padEnd(7)} ${shell} [${spec.skill}]`;
}

async function secrets(flags: Set<string>): Promise<void> {
  const inAmp = await userSecretNames();
  for (const spec of secretSpecs) {
    const value = localValue(spec, process.env);
    if (flags.has("--set") && value !== undefined) {
      await setUserSecret(spec, value);
      inAmp.add(spec.name);
    }
    console.log(secretLine(spec, value !== undefined, inAmp.has(spec.name)));
  }
}

const commands: Record<string, (flags: Set<string>) => Promise<void>> = { publish, secrets };

const [name, ...rest] = Bun.argv.slice(2);
const command = name === undefined ? undefined : commands[name];
if (command === undefined) {
  console.error(usage);
  process.exit(1);
}
await command(new Set(rest));
