import { loadBoard } from "./board/load.ts";
import { createHc, createHerdr, initLedger, ledgerPaths, startCoordinator } from "./core/index.ts";
import { down, repoRoot, status, up, type ControlDeps } from "./daemon/control.ts";
import { daemonOptions, runDaemon } from "./daemon/daemon.ts";
import { dismissInbox } from "./daemon/inbox.ts";
import { designFromInbox, openTask, type OpenDeps } from "./daemon/open.ts";
import { createInboxSources } from "./daemon/sources.ts";

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

function openDeps(): OpenDeps {
  return { hc: createHc(), herdr: createHerdr(), paths: ledgerPaths() };
}

function print(args: string[], value: object, line: string): void {
  console.log(args.includes("--json") ? JSON.stringify(value) : line);
}

function operand(args: string[], usage: string): string {
  const value = args.find((arg) => !arg.startsWith("--"));
  if (!value) throw new Error(`usage: bun run factory ${usage}`);
  return value;
}

async function open(args: string[]): Promise<void> {
  const opened = await openTask(operand(args, "open <task-id> [--json]"), openDeps());
  const action = `${opened.started ? "started, " : ""}${opened.focused ? "focused" : "not focused"}`;
  print(args, opened, opened.message ?? `${opened.terminal}: ${action}`);
}

const inboxCommands = new Map<string, Command>([
  [
    "dismiss",
    async (args) => {
      const id = operand(args, "inbox dismiss <event-id> [--json]");
      const event = await dismissInbox(ledgerPaths(), createInboxSources(), id);
      print(args, { ok: true }, `dismissed ${event.thread}`);
    },
  ],
  [
    "design",
    async (args) => {
      const id = operand(args, "inbox design <event-id> [--json]");
      const designed = await designFromInbox(id, openDeps());
      print(
        args,
        designed,
        `made the sketch ${designed.task}; its design agent is ${designed.terminal}`,
      );
    },
  ],
]);

async function inbox(args: string[]): Promise<void> {
  const [name = "", ...rest] = args;
  const command = inboxCommands.get(name);
  if (!command) throw new Error("usage: bun run factory inbox dismiss|design <event-id> [--json]");
  await command(rest);
}

/** The CLI commands by name. */
export const commands = new Map<string, Command>([
  ["init", init],
  ["up", printing(up)],
  ["down", printing(down)],
  ["status", printing(status)],
  ["daemon", daemon],
  ["board", board],
  ["open", open],
  ["inbox", inbox],
]);

function usage(): string {
  return `usage: bun run factory <command>\ncommands: ${[...commands.keys()].join(", ")}`;
}

function fail(args: string[], error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (args.includes("--json")) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(message);
  return 1;
}

/**
 * Runs the command in `argv` (the arguments after the script). Returns the exit code. With `--json`,
 * an error prints `{ ok: false, error }` to stdout.
 */
export async function main(argv: string[]): Promise<number> {
  const [name = "", ...args] = argv;
  const command = commands.get(name);
  if (!command) {
    console.error(usage());
    return 2;
  }
  return command(args).then(
    () => 0,
    (error: unknown) => fail(args, error),
  );
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
