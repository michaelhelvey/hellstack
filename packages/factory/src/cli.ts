import { loadBoard } from "./board/load.ts";
import { createHc, initLedger, ledgerPaths, startCoordinator } from "./core/index.ts";
import { down, repoRoot, status, up, type ControlDeps } from "./daemon/control.ts";
import { daemonOptions, runDaemon } from "./daemon/daemon.ts";

/** A CLI command. It gets the arguments after the command name. */
export type Command = (args: string[]) => Promise<void>;

async function init(): Promise<void> {
  const paths = ledgerPaths();
  const written = await initLedger(paths);
  for (const path of written) console.log(`wrote ${path}`);
  console.log(`the factory ledger is ready in ${paths.home}`);
}

function controlDeps(): ControlDeps {
  const hc = createHc();
  const paths = ledgerPaths();
  return {
    hc,
    paths,
    root: repoRoot(),
    startCoordinator: (config) => startCoordinator(config, { restart: false, deps: { hc, paths } }),
  };
}

function printing(run: (deps: ControlDeps) => Promise<string[]>): Command {
  return async () => {
    for (const line of await run(controlDeps())) console.log(line);
  };
}

async function daemon(args: string[]): Promise<void> {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
  const options = daemonOptions(
    ledgerPaths(),
    !args.includes("--no-agents"),
    !args.includes("--no-coordinator"),
  );
  await runDaemon(options, controller.signal);
}

async function board(args: string[]): Promise<void> {
  if (!args.includes("--json")) throw new Error("usage: bun run factory board --json");
  console.log(JSON.stringify(await loadBoard()));
}

/** The CLI commands by name. */
export const commands = new Map<string, Command>([
  ["init", init],
  ["up", printing(up)],
  ["down", printing(down)],
  ["status", printing(status)],
  ["daemon", daemon],
  ["board", board],
]);

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
  return command(args).then(
    () => 0,
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    },
  );
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
