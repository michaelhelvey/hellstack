import {
  COORDINATOR_TERMINAL,
  isRunningPi,
  workerTerminal,
  type FactoryEvent,
  type HcTerminal,
  type Task,
} from "../core/index.ts";
import type { Passed } from "./filter.ts";

/** The value of {@link Route.to} for an event that no task owns. */
export const INBOX = "inbox";

/**
 * Where one event goes: a terminal name or {@link INBOX}. `task` is the task that owns the thread.
 * `wake` is true when the event goes into the digest of the coordinator.
 */
export interface Route {
  to: string;
  event: FactoryEvent;
  task?: string;
  wake: boolean;
}

/** Returns the terminals that run pi, by name. */
export function runningPi(terminals: HcTerminal[]): Set<string> {
  return new Set(terminals.filter(isRunningPi).flatMap((terminal) => terminal.name ?? []));
}

function taskRoute(event: FactoryEvent, task: Task, running: Set<string>): Route {
  const worker = workerTerminal(task.meta.id);
  const toWorker = running.has(worker) && !task.meta.paused;
  const to = toWorker ? worker : COORDINATOR_TERMINAL;
  return { to, event, task: task.meta.id, wake: !toWorker };
}

/**
 * Returns where an event goes. Each task that owns the thread gets a route: to its worker when the
 * worker runs pi and the task is not paused, else to the coordinator. An event that no task owns
 * goes to the inbox, and also to the coordinator when its action is `wake`.
 */
export function routeEvent(
  { event, action }: Passed,
  tasks: Task[],
  running: Set<string>,
): Route[] {
  const owners = tasks.filter((task) => task.meta.threads.includes(event.thread));
  if (owners.length === 0) return [{ to: INBOX, event, wake: action === "wake" }];
  return owners.map((task) => taskRoute(event, task, running));
}

/** Returns the message line of a routed event. */
export function eventLine(route: Route): string {
  const { event } = route;
  const owner = route.task ? `(task ${route.task})` : "(inbox)";
  const summary = JSON.stringify(event.summary);
  return `- event ${event.id} ${event.thread} ${event.kind} ${summary} ${event.url} ${owner}`;
}

/** Returns the ids of the inbox events whose thread a task owns now. */
export function ownedInbox(inbox: FactoryEvent[], tasks: Task[]): string[] {
  const owned = new Set(tasks.flatMap((task) => task.meta.threads));
  return inbox.filter((event) => owned.has(event.thread)).map((event) => event.id);
}
