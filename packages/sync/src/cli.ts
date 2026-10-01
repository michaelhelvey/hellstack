import { homedir } from "node:os";
import { join } from "node:path";

import { gatewayIntegration } from "./gateway.ts";
import { integrations, runIntegrations } from "./integrations.ts";
import { planEntries } from "./plan.ts";
import { resolveRoots } from "./roots.ts";
import { displayPath, sync } from "./sync.ts";

const usage = `Usage: bun run sync [--dry-run]

Copies the config and skills in this repository to Claude Code, opencode, and pi.

  --dry-run   Show the changes, but do not change files or run integrations`;

function log(line: string): void {
  console.log(line);
}

/** The repository root. */
const repo = join(import.meta.dir, "..", "..", "..");

function parseArgs(args: string[]): { dryRun: boolean } | undefined {
  const unknown = args.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) return undefined;
  return { dryRun: args.includes("--dry-run") };
}

async function main(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === undefined) {
    console.error(usage);
    return 2;
  }
  const roots = resolveRoots(homedir(), process.env);
  const failed: string[] = [];
  async function afterApply(): Promise<void> {
    const gateway = await gatewayIntegration(roots.home);
    const list = gateway === undefined ? integrations : [...integrations, gateway];
    failed.push(...(await runIntegrations(list, log)));
  }
  const entries = await planEntries(repo, roots);
  const result = await sync({ entries, roots, dryRun: parsed.dryRun, log, afterApply });
  console.log(`${result.actions.length} changed, ${result.unchanged} unchanged`);
  console.log(`manifest: ${displayPath(join(roots.state, "manifest.json"), roots.home)}`);
  if (failed.length > 0) console.error(`failed integrations: ${failed.join(", ")}`);
  return failed.length > 0 ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
