import { initLedger, ledgerPaths } from "./core/index.ts";

/** A CLI command. It gets the arguments after the command name. */
export type Command = (args: string[]) => Promise<void>;

async function init(): Promise<void> {
  const paths = ledgerPaths();
  const written = await initLedger(paths);
  for (const path of written) console.log(`wrote ${path}`);
  console.log(`the factory ledger is ready in ${paths.home}`);
}

/** The CLI commands by name. */
export const commands = new Map<string, Command>([["init", init]]);

function usage(): string {
  return `usage: bun run factory <command>\ncommands: ${[...commands.keys()].join(", ")}`;
}

/** Runs the command in `argv` (the arguments after the script). Returns the exit code. */
export async function main(argv: string[]): Promise<number> {
  const [name = "", ...args] = argv;
  const command = commands.get(name);
  if (!command) {
    console.error(usage());
    return 2;
  }
  await command(args);
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
