import type { AgentConfig, Config } from "./config.ts";
import { createHc, type Hc, type HcRunOptions, type HcTerminal } from "./hc.ts";
import {
  applyNames,
  coordinatorPlacement,
  createHerdr,
  NO_WINDOW,
  workerPlacement,
  type Herdr,
  type HerdrPlacement,
  type HerdrSpace,
} from "./herdr.ts";
import { ledgerPaths, taskPath, type LedgerPaths } from "./paths.ts";
import type { Task } from "./task.ts";

/** The name of the coordinator terminal. */
export const COORDINATOR_TERMINAL = "factory";

/** The prompt that a restarted worker gets. */
export const WORKER_RESTART_PROMPT = "You were restarted. Read your task file again and continue.";

/** The prompt that a restarted coordinator gets. */
export const COORDINATOR_RESTART_PROMPT = "You were restarted. Read the ledger again and continue.";

/** What spawn uses. `pi` is the program and its first arguments; tests can give another program. */
export interface SpawnDeps {
  hc: Hc;
  herdr: Herdr;
  pi: string[];
  paths: LedgerPaths;
}

/** The options of a start. `restart` selects the restart prompt instead of the first prompt. */
export interface SpawnOptions {
  restart: boolean;
  deps?: Partial<SpawnDeps>;
}

/** A started terminal, and whether it has a place in Herdr or the Herdr window does not run. */
export interface Started {
  terminal: HcTerminal;
  herdr: "placed" | typeof NO_WINDOW;
}

/** Returns the name of the worker terminal of task `id`. */
export function workerTerminal(id: string): string {
  return `factory-${id}`;
}

function resolveDeps(deps: Partial<SpawnDeps> = {}): SpawnDeps {
  return { hc: createHc(), herdr: createHerdr(), pi: ["pi"], paths: ledgerPaths(), ...deps };
}

function piArgv(pi: string[], sessionId: string, agent: AgentConfig, prompt: string): string[] {
  return [
    ...pi,
    "--session-id",
    sessionId,
    "--model",
    agent.model,
    "--thinking",
    agent.thinking,
    prompt,
  ];
}

/** Returns the `hc run` options of the worker of `task`. */
export function workerRun(
  task: Task,
  config: Config,
  options: { restart: boolean; pi: string[]; paths: LedgerPaths },
): HcRunOptions {
  const { id, repo } = task.meta;
  const prompt = options.restart
    ? WORKER_RESTART_PROMPT
    : `You are the factory worker of task ${id}. Your task file is ${taskPath(options.paths, id)}. Read it and do the task.`;
  return {
    name: workerTerminal(id),
    cwd: repo,
    env: { FACTORY_ROLE: "worker", FACTORY_TASK: id, FACTORY_HOME: options.paths.home },
    argv: piArgv(options.pi, id, config.worker, prompt),
  };
}

/** Returns the `hc run` options of the coordinator. */
export function coordinatorRun(
  config: Config,
  options: { restart: boolean; pi: string[]; paths: LedgerPaths },
): HcRunOptions {
  const prompt = options.restart
    ? COORDINATOR_RESTART_PROMPT
    : "You are the factory coordinator. Read the ledger and tell the user what needs them.";
  return {
    name: COORDINATOR_TERMINAL,
    cwd: options.paths.home,
    env: { FACTORY_ROLE: "coordinator", FACTORY_HOME: options.paths.home },
    argv: piArgv(options.pi, "factory", config.coordinator, prompt),
  };
}

async function removeOld(hc: Hc, name: string): Promise<void> {
  const old = await hc.get(name);
  if (!old) return;
  if (old.state === "live") await hc.kill(name);
  await hc.rm(name);
}

async function startTerminal(
  run: HcRunOptions,
  place: (spaces: HerdrSpace[]) => Promise<HerdrPlacement>,
  deps: SpawnDeps,
): Promise<Started> {
  await removeOld(deps.hc, run.name);
  const spaces = await deps.herdr.spaces().catch(() => NO_WINDOW);
  if (spaces === NO_WINDOW) return { terminal: await deps.hc.run(run), herdr: NO_WINDOW };
  const placement = await place(spaces);
  const terminal = await deps.hc.run({ ...run, labels: placement.labels });
  await applyNames(deps.herdr, placement.names);
  return { terminal, herdr: "placed" };
}

/**
 * Starts the worker of `task` in the terminal `factory-<id>`. It ends and removes an old terminal
 * with that name first. Only call it when the worker does not run pi.
 */
export async function startWorker(
  task: Task,
  config: Config,
  options: SpawnOptions,
): Promise<Started> {
  const deps = resolveDeps(options.deps);
  const run = workerRun(task, config, { ...deps, restart: options.restart });
  const tabName = `${task.meta.id} ${task.meta.title}`.slice(0, 40);
  return startTerminal(
    run,
    (spaces) => workerPlacement(spaces, { id: task.meta.id, repo: task.meta.repo, tabName }),
    deps,
  );
}

/**
 * Starts the coordinator in the terminal `factory`. It ends and removes an old terminal with that
 * name first. Only call it when the coordinator does not run pi.
 */
export async function startCoordinator(config: Config, options: SpawnOptions): Promise<Started> {
  const deps = resolveDeps(options.deps);
  const run = coordinatorRun(config, { ...deps, restart: options.restart });
  return startTerminal(run, (spaces) => Promise.resolve(coordinatorPlacement(spaces)), deps);
}
