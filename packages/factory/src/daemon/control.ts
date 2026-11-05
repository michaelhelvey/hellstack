import { fileURLToPath } from "node:url";

import {
  COORDINATOR_TERMINAL,
  initLedger,
  listInbox,
  listTasks,
  loadConfig,
  readFeed,
  removeTerminal,
  taskStatusSchema,
  workerTerminal,
  type Config,
  type Hc,
  type HcRunOptions,
  type HcTerminal,
  type LedgerPaths,
  type Task,
} from "../core/index.ts";
import { runningPi } from "./route.ts";

/** The name of the daemon terminal. */
export const DAEMON_TERMINAL = "factoryd";

/** What `up`, `down`, and `status` use. Tests give fakes. */
export interface ControlDeps {
  hc: Hc;
  paths: LedgerPaths;
  /** The repository root, the cwd of the daemon. */
  root: string;
  /** Starts the coordinator. */
  startCoordinator: (config: Config) => Promise<unknown>;
}

/** Returns the root folder of this repository. */
export function repoRoot(): string {
  return fileURLToPath(new URL("../../../..", import.meta.url));
}

/**
 * Returns the `hc run` options of the daemon terminal. `hc run` does not give the environment of
 * the caller to the terminal, so the daemon starts in a login shell of the user: it gets the tokens
 * that the shell files export (for example `SENTRY_AUTH_TOKEN`), and the tokens are not in argv.
 */
export function daemonRun(paths: LedgerPaths, root: string, shell = "/bin/zsh"): HcRunOptions {
  return {
    name: DAEMON_TERMINAL,
    cwd: root,
    env: { FACTORY_HOME: paths.home },
    argv: [shell, "-lic", "exec bun packages/factory/src/cli.ts daemon"],
  };
}

function findLive(terminals: HcTerminal[], name: string): HcTerminal | undefined {
  return terminals.find((terminal) => terminal.name === name && terminal.state === "live");
}

/**
 * Starts the coordinator and then `factoryd` when they do not run. It makes the ledger first. It is
 * safe to run more than once. Returns the lines to print.
 */
export async function up(deps: ControlDeps): Promise<string[]> {
  await initLedger(deps.paths);
  const terminals = await deps.hc.ls();
  const lines: string[] = [];
  if (runningPi(terminals).has(COORDINATOR_TERMINAL)) lines.push("the coordinator runs");
  else {
    await deps.startCoordinator(await loadConfig(deps.paths));
    lines.push("started the coordinator");
  }
  if (findLive(terminals, DAEMON_TERMINAL)) return [...lines, "factoryd runs"];
  await removeTerminal(deps.hc, DAEMON_TERMINAL);
  await deps.hc.run(daemonRun(deps.paths, deps.root, process.env.SHELL));
  return [...lines, "started factoryd"];
}

/** Stops `factoryd` and the coordinator. Workers continue. Returns the lines to print. */
export async function down(deps: ControlDeps): Promise<string[]> {
  await removeTerminal(deps.hc, DAEMON_TERMINAL);
  await removeTerminal(deps.hc, COORDINATOR_TERMINAL);
  return ["stopped factoryd and the coordinator"];
}

function terminalLine(label: string, terminal: HcTerminal | undefined): string {
  if (!terminal) return `${label}: stopped`;
  return `${label}: running (${terminal.address}, ${terminal.status ?? terminal.state}, turn ${terminal.turn})`;
}

/** Returns the task counts by status, for example `2 working, 1 ready`. */
export function taskCounts(tasks: Task[]): string {
  const counts = taskStatusSchema.options
    .map((status) => [status, tasks.filter((task) => task.meta.status === status).length] as const)
    .filter(([, count]) => count > 0);
  return counts.length > 0
    ? counts.map(([status, count]) => `${count} ${status}`).join(", ")
    : "none";
}

async function sourceLines(paths: LedgerPaths): Promise<string[]> {
  const last = new Map((await readFeed(200, paths)).map((record) => [record.source, record]));
  return [...last.values()].map(
    (record) => `${record.source}: ${record.ok ? "ok" : "error"} ${record.ts} ${record.summary}`,
  );
}

/** Returns the lines of `factory status`: what runs, the task counts, the inbox, and the sources. */
export async function status(deps: ControlDeps): Promise<string[]> {
  const terminals = await deps.hc.ls();
  const { tasks, invalid } = await listTasks(deps.paths);
  const running = runningPi(terminals);
  const workers = tasks.filter((task) => running.has(workerTerminal(task.meta.id))).length;
  return [
    `ledger: ${deps.paths.home}`,
    terminalLine("factoryd", findLive(terminals, DAEMON_TERMINAL)),
    terminalLine("coordinator", findLive(terminals, COORDINATOR_TERMINAL)),
    `workers: ${workers} running`,
    `tasks: ${taskCounts(tasks)}${invalid.length > 0 ? ` (${invalid.length} not valid)` : ""}`,
    `inbox: ${(await listInbox(deps.paths)).length}`,
    ...(await sourceLines(deps.paths)),
  ];
}
