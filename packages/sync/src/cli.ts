import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { runIntegrations } from "./integrations.ts";
import { type Layers, layersPath, parseLayerList, readLayers } from "./layers.ts";
import { planRepo } from "./plan.ts";
import { resolveRoots, type Roots } from "./roots.ts";
import { displayPath, sync } from "./sync.ts";

const usage = `Usage: bun run sync [--dry-run] [--layers <names>]

Copies the config and skills in this repository to Claude Code, opencode, and pi.

  --dry-run          Show the changes, but do not change files or run integrations
  --layers <names>   Use these comma-separated layers, not the layers in
                     ~/.config/hellstack/layers.json. Use --layers "" for no layers.`;

function log(line: string): void {
  console.log(line);
}

/** The repository root. */
const repo = join(import.meta.dir, "..", "..", "..");

interface Args {
  dryRun: boolean;
  layers: string | undefined;
}

function parse(args: string[]): Args | undefined {
  try {
    const { values } = parseArgs({
      args,
      options: { "dry-run": { type: "boolean" }, layers: { type: "string" } },
    });
    return { dryRun: values["dry-run"] ?? false, layers: values.layers };
  } catch {
    return undefined;
  }
}

async function resolveLayers(
  flag: string | undefined,
  configDir: string,
): Promise<Layers | undefined> {
  if (flag !== undefined) return parseLayerList(flag);
  return readLayers(layersPath(configDir)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    return undefined;
  });
}

async function runSync(roots: Roots, layers: Layers, dryRun: boolean): Promise<number> {
  const plan = await planRepo(repo, roots, layers);
  const failed: string[] = [];
  async function afterApply(): Promise<void> {
    failed.push(...(await runIntegrations(plan.integrations, log)));
  }
  const result = await sync({ entries: plan.entries, roots, dryRun, log, afterApply });
  console.log(`${result.actions.length} changed, ${result.unchanged} unchanged`);
  console.log(`manifest: ${displayPath(join(roots.state, "manifest.json"), roots.home)}`);
  if (failed.length > 0) console.error(`failed integrations: ${failed.join(", ")}`);
  return failed.length > 0 ? 1 : 0;
}

async function main(args: string[]): Promise<number> {
  const parsed = parse(args);
  if (parsed === undefined) {
    console.error(usage);
    return 2;
  }
  const roots = resolveRoots(homedir(), process.env);
  const layers = await resolveLayers(parsed.layers, roots.config);
  if (layers === undefined) return 2;
  console.log(`layers: ${[...layers].join(", ") || "(none)"}`);
  return runSync(roots, layers, parsed.dryRun);
}

process.exitCode = await main(process.argv.slice(2));
