import { parseArgs } from "util";

import { loadDependencies } from "./lib/deps.ts";
import { fixWhitespace } from "./lib/oxlint.ts";

const USAGE = `
whitespace

Adds blank lines between statements with oxlint --fix.

USAGE:
    bun whitespace.ts [OPTIONS] PATH...

OPTIONS:
    -h, --help    Show this message.
`.trim();

function usageAndExit(code: number, additionalMessage?: string): never {
  const message = additionalMessage ? `${additionalMessage}\n\n${USAGE}` : USAGE;

  (code === 0 ? console.log : console.error)(message);
  process.exit(code);
}

function parseCliArgs() {
  try {
    return parseArgs({
      args: Bun.argv.slice(2),
      options: { help: { type: "boolean", short: "h" } },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    return usageAndExit(1, `Invalid arguments: ${String(error)}`);
  }
}

const { values, positionals: files } = parseCliArgs();

if (values.help) {
  usageAndExit(0);
}

if (files.length < 1) {
  usageAndExit(1, "Invalid arguments: expected at least one path");
}

process.exit(await fixWhitespace(await loadDependencies(), files));
