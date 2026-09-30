import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ELK } from "elkjs/lib/elk-api.js";
import type { PuppeteerNode } from "puppeteer-core";

import { createElk } from "./elk.ts";
import type { Zod } from "./spec.ts";

/** The packages that the script loads at run time, with exact versions. */
export const DEPENDENCIES = {
  "@kitschpatrol/tldraw-cli": "6.0.4",
  elkjs: "0.12.0",
  zod: "4.6.5",
} as const;

/** The packages that the script uses, loaded from the cache directory. */
export interface Dependencies {
  z: Zod;
  /** Makes an ELK instance that runs in this thread. */
  createElk: () => ELK;
  puppeteer: PuppeteerNode;
  /** The directory of the tldraw app that tldraw-cli serves to its headless browser. */
  tldrawAppDir: string;
}

type EntryModule = Omit<Dependencies, "createElk">;

const ENTRY_MODULE = `import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
export { z } from "zod";
const cli = new URL("./node_modules/@kitschpatrol/tldraw-cli/", import.meta.url);
export const puppeteer = createRequire(new URL("package.json", cli))("puppeteer");
export const tldrawAppDir = fileURLToPath(new URL("dist/tldraw/", cli));
`;

function cacheDirectory(): string {
  const key = JSON.stringify(DEPENDENCIES) + ENTRY_MODULE;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  const root = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(root, "tldraw-diagram-skill", hash);
}

async function install(dir: string, entry: string): Promise<void> {
  console.error(`Installing tldraw-cli and elkjs into ${dir} (first run only)...`);
  await mkdir(dir, { recursive: true });
  const manifest = {
    private: true,
    type: "module",
    dependencies: DEPENDENCIES,
    trustedDependencies: ["puppeteer"],
  };
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  const result = spawnSync(process.execPath, ["install"], { cwd: dir, stdio: ["ignore", 2, 2] });
  if (result.status !== 0) throw new Error(`bun install failed in ${dir}`);
  await writeFile(entry, ENTRY_MODULE);
}

/** Installs the dependencies into a cache directory on the first run, then loads them. */
export async function loadDependencies(): Promise<Dependencies> {
  const dir = cacheDirectory();
  const entry = join(dir, "entry.mjs");
  if (!existsSync(entry)) await install(dir, entry);
  const loaded = (await import(pathToFileURL(entry).href)) as EntryModule;
  return { ...loaded, createElk: () => createElk(join(dir, "package.json")) };
}
