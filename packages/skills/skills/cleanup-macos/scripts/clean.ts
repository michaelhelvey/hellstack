import { join } from "node:path";
import { parseArgs } from "node:util";

import { toolCaches } from "./lib/caches.ts";
import { formatBytes, freeSpace, HOME, mapLimit } from "./lib/fs.ts";
import { resolveTargets, type Target } from "./lib/targets.ts";

const USAGE = `
clean

Removes tool caches, project artifacts, and cache directories that scan.ts found. It refuses
all of the targets when one target does not obey the scan rules.

USAGE:
    bun clean.ts [OPTIONS] TARGET...

TARGET:
    A tool cache ID (for example, npm), or the absolute path of a project artifact or a cache
    directory from scan.ts.

OPTIONS:
    -r, --root DIR    A source code directory that can contain artifacts. Repeat for more
                      directories. Default: ~/dev
    -n, --dry-run     Show the targets, but do not remove them.
    -h, --help        Show this message.
`.trim();

const CONCURRENCY = 8;

function usageAndExit(code: number, additionalMessage?: string): never {
  const message = additionalMessage ? `${additionalMessage}\n\n${USAGE}` : USAGE;

  (code === 0 ? console.log : console.error)(message);
  process.exit(code);
}

function parseCliArgs() {
  try {
    return parseArgs({
      args: Bun.argv.slice(2),
      options: {
        root: { type: "string", short: "r", multiple: true },
        "dry-run": { type: "boolean", short: "n" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    return usageAndExit(1, `Invalid arguments: ${String(error)}`);
  }
}

async function removeTarget(target: Target): Promise<boolean> {
  try {
    await target.remove();
    console.log(`removed\t${target.label}`);

    return true;
  } catch (error) {
    console.error(`failed\t${target.label}\t${String(error)}`);

    return false;
  }
}

const { values: options, positionals } = parseCliArgs();

if (options.help) usageAndExit(0);

if (positionals.length === 0) usageAndExit(1, "Invalid arguments: expected at least one target");

const roots = options.root ?? [join(HOME, "dev")];
const targets = await resolveTargets(positionals, toolCaches(), roots).catch((error: unknown) =>
  usageAndExit(1, `Refused: ${error instanceof Error ? error.message : String(error)}`),
);

if (options["dry-run"]) {
  for (const target of targets) console.log(`would remove\t${target.label}`);

  process.exit(0);
}

const before = await freeSpace(HOME);
const results = await mapLimit(targets, CONCURRENCY, removeTarget);
const after = await freeSpace(HOME);

console.log(`\nFree space: ${formatBytes(before)} -> ${formatBytes(after)}`);
process.exit(results.every(Boolean) ? 0 : 1);
