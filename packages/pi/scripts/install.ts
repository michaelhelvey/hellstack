import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

const PACKAGES_DIR = path.resolve(import.meta.dir, "../..");

/** The pi packages in this repository. Pi loads them from here, so a change applies at once. */
export const REPO_PACKAGES = ["pi", "skills"].map((name) => path.join(PACKAGES_DIR, name));

const PackageSchema = z.union([z.string(), z.looseObject({ source: z.string() })]);

const SettingsSchema = z.looseObject({ packages: z.array(PackageSchema).default([]) });

type Package = z.infer<typeof PackageSchema>;

function sourceOf(entry: Package): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isMissingPath(source: string, exists: (path: string) => boolean): boolean {
  return path.isAbsolute(source) && !exists(source);
}

/**
 * Returns the pi settings with the values of `ours` and the packages of this repository. It keeps
 * the other settings and packages of this machine, and removes local packages that do not exist.
 */
export function mergeSettings(
  current: unknown,
  ours: unknown,
  exists: (path: string) => boolean = existsSync,
): Record<string, unknown> {
  const mine = SettingsSchema.parse(current);
  const base = SettingsSchema.parse(ours);
  const wanted = [...base.packages, ...REPO_PACKAGES];
  const kept = mine.packages.filter((entry) => !isMissingPath(sourceOf(entry), exists));
  const added = wanted.filter((entry) => !kept.some((k) => sourceOf(k) === sourceOf(entry)));
  return { ...mine, ...base, packages: [...kept, ...added] };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
}

async function writeSettings(agentDir: string): Promise<void> {
  const file = path.join(agentDir, "settings.json");
  const ours = await readJson(path.join(PACKAGES_DIR, "pi", "agent-settings.json"));
  const settings = mergeSettings(await readJson(file), ours);
  await mkdir(agentDir, { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function installHerdr(): void {
  if (Bun.which("herdr") === null) return;
  Bun.spawnSync(["herdr", "integration", "install", "pi"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function envDir(name: string, fallback: string[]): string {
  return process.env[name] ?? path.join(homedir(), ...fallback);
}

async function main(): Promise<void> {
  const agentDir = envDir("PI_CODING_AGENT_DIR", [".pi", "agent"]);
  await writeSettings(agentDir);
  installHerdr();
  console.log(`pi: ${path.join(agentDir, "settings.json")} loads ${REPO_PACKAGES.join(" and ")}`);
}

if (import.meta.main) await main();
