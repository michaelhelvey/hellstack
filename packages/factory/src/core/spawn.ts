import type { AgentConfig, Config } from "./config.ts";
import { createHc, removeTerminal, type Hc, type HcRunOptions, type HcTerminal } from "./hc.ts";
import {
  applyNames,
  coordinatorPlacement,
  createHerdr,
  NO_WINDOW,
  taskPlacement,
  type Herdr,
  type HerdrPlacement,
  type HerdrSpace,
} from "./herdr.ts";
import { ledgerPaths, taskPath, type LedgerPaths } from "./paths.ts";
import type { Task } from "./task.ts";

/** The name of the coordinator terminal. */
export const COORDINATOR_TERMINAL = "factory";

/** The name of the daemon terminal. */
export const DAEMON_TERMINAL = "factoryd";

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

/** The agents that belong to one task: its worker and its design agent. */
export type TaskAgentRole = "worker" | "design";

/** The options of the `hc run` options of a task agent. */
export interface RunOptions {
  restart: boolean;
  pi: string[];
  paths: LedgerPaths;
}

/** Returns the name of the worker terminal of task `id`. */
export function workerTerminal(id: string): string {
  return `factory-${id}`;
}

/** Returns the name of the design terminal of task `id`. */
export function designTerminal(id: string): string {
  return `factory-design-${id}`;
}

interface TaskAgentSpec {
  terminal: (id: string) => string;
  session: (id: string) => string;
  tab: (id: string) => string;
  noun: string;
  intro: string;
}

const TASK_AGENTS: Record<TaskAgentRole, TaskAgentSpec> = {
  worker: {
    terminal: workerTerminal,
    session: (id) => id,
    tab: (id) => `tbfactory-${id}`,
    noun: "worker",
    intro: "Read it and do the task.",
  },
  design: {
    terminal: designTerminal,
    session: (id) => `design-${id}`,
    tab: (id) => `tbfactory-design-${id}`,
    noun: "design agent",
    intro: "Read it, then help the user write its contract.",
  },
};

/** Returns the name of the terminal of the `role` agent of task `id`. */
export function taskTerminal(role: TaskAgentRole, id: string): string {
  return TASK_AGENTS[role].terminal(id);
}

/** Returns the Herdr tab id of the `role` agent of task `id`. */
export function taskTab(role: TaskAgentRole, id: string): string {
  return TASK_AGENTS[role].tab(id);
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

function taskPrompt(role: TaskAgentRole, id: string, options: RunOptions): string {
  if (options.restart) return WORKER_RESTART_PROMPT;
  const { noun, intro } = TASK_AGENTS[role];
  return `You are the factory ${noun} of task ${id}. Your task file is ${taskPath(options.paths, id)}. ${intro}`;
}

/**
 * Returns the `hc run` options of the `role` agent of `task`. Both agents use the worker model and
 * run in the task `cwd`.
 */
export function taskRun(
  role: TaskAgentRole,
  task: Task,
  config: Config,
  options: RunOptions,
): HcRunOptions {
  const { id, cwd } = task.meta;
  const spec = TASK_AGENTS[role];
  return {
    name: spec.terminal(id),
    cwd,
    env: { FACTORY_ROLE: role, FACTORY_TASK: id, FACTORY_HOME: options.paths.home },
    argv: piArgv(options.pi, spec.session(id), config.worker, taskPrompt(role, id, options)),
  };
}

/** Returns the `hc run` options of the worker of `task`. */
export function workerRun(task: Task, config: Config, options: RunOptions): HcRunOptions {
  return taskRun("worker", task, config, options);
}

/** Returns the `hc run` options of the coordinator. */
export function coordinatorRun(config: Config, options: RunOptions): HcRunOptions {
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

async function startTerminal(
  run: HcRunOptions,
  place: (spaces: HerdrSpace[]) => Promise<HerdrPlacement>,
  deps: SpawnDeps,
): Promise<Started> {
  await removeTerminal(deps.hc, run.name);
  const spaces = await deps.herdr.spaces().catch(() => NO_WINDOW);
  if (spaces === NO_WINDOW) return { terminal: await deps.hc.run(run), herdr: NO_WINDOW };
  const placement = await place(spaces);
  const terminal = await deps.hc.run({ ...run, labels: placement.labels });
  await applyNames(deps.herdr, placement.names);
  return { terminal, herdr: "placed" };
}

/**
 * Starts the `role` agent of `task` in its terminal, in the Herdr space of the task `cwd`. It ends
 * and removes an old terminal with that name first. Only call it when the agent does not run pi.
 */
export async function startTaskAgent(
  role: TaskAgentRole,
  task: Task,
  config: Config,
  options: SpawnOptions,
): Promise<Started> {
  const deps = resolveDeps(options.deps);
  const run = taskRun(role, task, config, { ...deps, restart: options.restart });
  const tab = taskTab(role, task.meta.id);
  const tabName = `${task.meta.id} ${task.meta.title}`.slice(0, 40);
  return startTerminal(
    run,
    (spaces) => taskPlacement(spaces, { cwd: task.meta.cwd, tab, tabName }),
    deps,
  );
}

/** Starts the worker of `task` in the terminal `factory-<id>` (see {@link startTaskAgent}). */
export function startWorker(task: Task, config: Config, options: SpawnOptions): Promise<Started> {
  return startTaskAgent("worker", task, config, options);
}

/**
 * Starts the design agent of `task` in the terminal `factory-design-<id>` (see
 * {@link startTaskAgent}).
 */
export function startDesign(task: Task, config: Config, options: SpawnOptions): Promise<Started> {
  return startTaskAgent("design", task, config, options);
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
