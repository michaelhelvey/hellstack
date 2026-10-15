import { join } from "node:path";
import { parseArgs } from "node:util";

import { type Artifact, findArtifacts, lastActivity } from "./lib/artifacts.ts";
import { cacheDirectories, toolCaches } from "./lib/caches.ts";
import { diskUsage, formatBytes, freeSpace, HOME, mapLimit, tildify } from "./lib/fs.ts";

const USAGE = `
scan

Finds caches and build artifacts that a cleanup can remove. It does not change files.

USAGE:
    bun scan.ts [OPTIONS]

OPTIONS:
    -r, --root DIR       A source code directory to search for artifacts. Repeat for more
                         directories. Default: ~/dev
    -m, --min-size MB    Do not show items smaller than this. Default: 50
    -h, --help           Show this message.
`.trim();

const DAY = 24 * 60 * 60 * 1000;
const CONCURRENCY = 16;

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
        "min-size": { type: "string", short: "m", default: "50" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    return usageAndExit(1, `Invalid arguments: ${String(error)}`);
  }
}

interface Row {
  size: number;
  columns: string[];
}

function printSection(title: string, header: string[], rows: Row[]): number {
  const total = rows.reduce((sum, row) => sum + row.size, 0);

  console.log(`## ${title} (${formatBytes(total)})\n`);
  console.log(["SIZE", ...header].join("\t"));

  for (const row of rows.toSorted((a, b) => b.size - a.size)) {
    console.log([formatBytes(row.size), ...row.columns].join("\t"));
  }

  console.log();

  return total;
}

async function toolCacheRows(): Promise<Row[]> {
  const caches = toolCaches();
  const sizes = await Promise.all(caches.map((cache) => cache.size()));

  return caches.flatMap((cache, index) => {
    const size = sizes[index];

    if (size === undefined) return [];

    return [{ size, columns: [cache.id, cache.description, cache.note ?? ""] }];
  });
}

async function artifactRow(artifact: Artifact, roots: string[]): Promise<Row> {
  const [size, active] = await Promise.all([
    diskUsage(artifact.path),
    lastActivity(artifact, roots),
  ]);
  const days = Math.floor((Date.now() - active) / DAY);

  return { size, columns: [`${days}d`, artifact.kind, artifact.path] };
}

async function artifactRows(roots: string[]): Promise<Row[]> {
  const artifacts = await findArtifacts(roots);

  return mapLimit(artifacts, CONCURRENCY, (artifact) => artifactRow(artifact, roots));
}

async function cacheDirectoryRows(): Promise<Row[]> {
  const dirs = await cacheDirectories(toolCaches());

  return mapLimit(dirs, CONCURRENCY, async (dir) => ({
    size: await diskUsage(dir),
    columns: [dir],
  }));
}

const options = parseCliArgs();

if (options.help) usageAndExit(0);

const minSize = Number(options["min-size"]) * 1024 * 1024;

function large(rows: Row[]): Row[] {
  return rows.filter((row) => row.size >= minSize);
}

if (Number.isNaN(minSize)) usageAndExit(1, "Invalid arguments: --min-size must be a number");

const roots = options.root ?? [join(HOME, "dev")];
const [tools, artifacts, directories] = await Promise.all([
  toolCacheRows(),
  artifactRows(roots),
  cacheDirectoryRows(),
]);

console.log(`Free space: ${formatBytes(await freeSpace(HOME))}\n`);

const total =
  printSection("Tool caches", ["ID", "DESCRIPTION", "NOTE"], large(tools)) +
  printSection(
    `Project artifacts in ${roots.map(tildify).join(", ")}`,
    ["IDLE", "KIND", "PATH"],
    large(artifacts),
  ) +
  printSection("Cache directories", ["PATH"], large(directories));

console.log(`Total shown: ${formatBytes(total)}`);
