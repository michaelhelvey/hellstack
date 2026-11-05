import {
  createTask,
  designTerminal,
  getTask,
  isRunningPi,
  loadConfig,
  NO_WINDOW,
  startTaskAgent,
  taskTerminal,
  threadRepo,
  type FactoryEvent,
  type Hc,
  type HcTerminal,
  type Herdr,
  type LedgerPaths,
  type Task,
  type TaskAgentRole,
  type TaskStatus,
} from "../core/index.ts";
import { findCheckout } from "./checkout.ts";
import { findInbox, removeThread } from "./inbox.ts";

/** What `open` and `inbox design` use. Tests give fakes. `pi` replaces the pi program. */
export interface OpenDeps {
  hc: Hc;
  herdr: Herdr;
  paths: LedgerPaths;
  pi?: string[];
}

/**
 * The result of `open`: the terminal of the agent, whether `open` started it, and whether Herdr
 * focused it.
 */
export interface Opened {
  terminal: string | null;
  started: boolean;
  focused: boolean;
  message?: string;
}

/** The result of `inbox design`: the new task and the terminal of its design agent. */
export interface Designed {
  task: string;
  terminal: string;
}

function runsPi(terminals: HcTerminal[], name: string): HcTerminal | undefined {
  return terminals.find((terminal) => terminal.name === name && isRunningPi(terminal));
}

const OPEN_ROLES: Record<TaskStatus, TaskAgentRole | "ready" | "dropped"> = {
  sketch: "design",
  ready: "ready",
  working: "worker",
  landing: "worker",
  landed: "worker",
  dropped: "dropped",
};

function agentRole(task: Task, terminals: HcTerminal[]): TaskAgentRole | undefined {
  const { id, status } = task.meta;
  const role = OPEN_ROLES[status];
  if (role === "dropped") throw new Error(`task ${id} is dropped`);
  if (role !== "ready") return role;
  return runsPi(terminals, designTerminal(id)) ? "design" : undefined;
}

async function ensureAgent(
  role: TaskAgentRole,
  task: Task,
  live: HcTerminal | undefined,
  deps: OpenDeps,
): Promise<{ address: string; shown: boolean }> {
  if (live) return { address: live.address, shown: true };
  const options = { restart: role === "worker", deps };
  const started = await startTaskAgent(role, task, await loadConfig(deps.paths), options);
  return { address: started.terminal.address, shown: started.herdr !== NO_WINDOW };
}

/**
 * Focuses the `role` agent of `task` in Herdr. When its terminal does not run pi, it starts the
 * agent first: a worker with the restart prompt, a design agent with its first prompt (pi resumes
 * the session when it exists).
 */
export async function focusAgent(
  role: TaskAgentRole,
  task: Task,
  terminals: HcTerminal[],
  deps: OpenDeps,
): Promise<Opened & { terminal: string }> {
  const name = taskTerminal(role, task.meta.id);
  const live = runsPi(terminals, name);
  const { address, shown } = await ensureAgent(role, task, live, deps);
  const focused = shown && (await deps.herdr.focus(address));
  return { terminal: name, started: !live, focused };
}

/**
 * Starts (when it does not run pi) and focuses the agent of task `id`: the design agent of a
 * `sketch`, the worker of a `working`, `landing`, or `landed` task. For a `ready` task, it focuses
 * the design agent when it runs, else it does nothing and tells why. It does not dispatch a task.
 */
export async function openTask(id: string, deps: OpenDeps): Promise<Opened> {
  const task = await getTask(id, deps.paths);
  const terminals = await deps.hc.ls();
  const role = agentRole(task, terminals);
  if (role) return focusAgent(role, task, terminals, deps);
  const message = `task ${id} is ready and has no design agent; the coordinator dispatches its worker`;
  return { terminal: null, started: false, focused: false, message };
}

/** Returns the Goal draft of a task that comes from an inbox event. */
export function goalDraft(event: FactoryEvent): string {
  return [
    `Draft from inbox event ${event.id} (${event.kind} on ${event.thread}): [${event.title}](${event.url})`,
    "",
    `> ${event.summary}`,
  ].join("\n");
}

async function eventCwd(event: FactoryEvent, paths: LedgerPaths): Promise<string> {
  const repo = threadRepo(event.thread);
  if (!repo) return paths.home;
  const config = await loadConfig(paths);
  return (await findCheckout(repo, config.repoRoots, paths)) ?? paths.home;
}

/**
 * Makes a `sketch` task from inbox event `id`: its title, its thread, and a Goal draft that links
 * the event. The task `cwd` is the local checkout of the event repository, else the ledger folder.
 * Then it removes the inbox events of the thread, and starts and focuses the design agent.
 */
export async function designFromInbox(id: string, deps: OpenDeps): Promise<Designed> {
  const event = await findInbox(deps.paths, id);
  const fields = {
    title: event.title || event.thread,
    threads: [event.thread],
    goal: goalDraft(event),
  };
  const task = await createTask({ ...fields, cwd: await eventCwd(event, deps.paths) }, deps.paths);
  await removeThread(deps.paths, event.thread);
  const opened = await focusAgent("design", task, await deps.hc.ls(), deps);
  return { task: task.meta.id, terminal: opened.terminal };
}
