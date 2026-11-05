import { designTerminal, workerTerminal, type HcTerminal, type Task } from "../core/index.ts";
import { runningPi } from "./route.ts";

/**
 * What the reconciler looks at. `notices` are the keys of the notices that it sent before. The
 * terminals of finished workers must have `status_ms` from `hc get`.
 */
export interface ReconcileInput {
  tasks: Task[];
  terminals: HcTerminal[];
  notices: string[];
  now: Date;
  staleAfterMinutes: number;
  closeAfterMinutes: number;
}

/**
 * The terminals of the agents of task `id`: its worker and its design agent. The reconciler closes
 * them when the task is finished.
 */
export function agentTerminals(id: string): string[] {
  return [workerTerminal(id), designTerminal(id)];
}

/** A worker or design terminal to close. `minutes` is the time since the task finished. */
export interface Close {
  task: Task;
  terminal: string;
  minutes: number;
}

/**
 * What the reconciler does: start workers, close the workers of finished tasks, tell the
 * coordinator, and remember the notices.
 */
export interface ReconcilePlan {
  start: Task[];
  close: Close[];
  notify: string[];
  notices: string[];
}

interface Notice {
  key: string;
  line: string;
}

/** Returns true when a worker must run for the task. */
export function wantsWorker(task: Task): boolean {
  const { status, paused } = task.meta;
  return (status === "working" || status === "landing") && !paused;
}

function readyNotice(task: Task): Notice[] {
  if (task.meta.status !== "ready") return [];
  const line = `- task ${task.meta.id} is ready: ${JSON.stringify(task.meta.title)}`;
  return [{ key: `ready:${task.meta.id}`, line }];
}

function staleNotice(task: Task, input: ReconcileInput, worker?: HcTerminal): Notice[] {
  const minutes = Math.floor((input.now.getTime() - Date.parse(task.meta.updated)) / 60_000);
  const busy = worker?.status === "working";
  if (!wantsWorker(task) || busy || minutes < input.staleAfterMinutes) return [];
  const line = `- task ${task.meta.id} has had no update for ${minutes} minutes and its worker is not working`;
  return [{ key: `stale:${task.meta.id}:${task.meta.updated}`, line }];
}

function finishedAt(task: Task): string | undefined {
  const { status, landed_at, updated } = task.meta;
  if (status === "landed") return landed_at ?? updated;
  if (status === "dropped") return updated;
  return undefined;
}

function idleWorker(worker?: HcTerminal): string | undefined {
  return worker?.status === "working" ? undefined : (worker?.name ?? undefined);
}

function idleSince(finished: string, statusMs?: number | null): number {
  return Math.max(Date.parse(finished), statusMs ?? 0);
}

function closeWorker(task: Task, input: ReconcileInput, worker?: HcTerminal): Close[] {
  const finished = finishedAt(task);
  const terminal = idleWorker(worker);
  if (terminal === undefined || finished === undefined) return [];
  const now = input.now.getTime();
  if (now - idleSince(finished, worker?.status_ms) < input.closeAfterMinutes * 60_000) return [];
  return [{ task, terminal, minutes: Math.floor((now - Date.parse(finished)) / 60_000) }];
}

function noticeTask(key: string): string {
  return key.split(":")[1] ?? "";
}

/**
 * Compares the tasks with the terminals. It starts each wanted worker that does not run pi. It
 * closes the worker and the design agent of each `landed` or `dropped` task when the agent is not
 * working and has been idle for `closeAfterMinutes` since the later of the finish time and its last
 * status change. It
 * tells the coordinator one time about each `ready` task and each stale task. It forgets the
 * notices of tasks that no longer exist.
 */
export function reconcile(input: ReconcileInput): ReconcilePlan {
  const running = runningPi(input.terminals);
  const byName = new Map(input.terminals.map((terminal) => [terminal.name, terminal]));
  function worker(task: Task): HcTerminal | undefined {
    return byName.get(workerTerminal(task.meta.id));
  }
  return {
    start: input.tasks.filter(
      (task) => wantsWorker(task) && !running.has(workerTerminal(task.meta.id)),
    ),
    close: input.tasks.flatMap((task) =>
      agentTerminals(task.meta.id).flatMap((name) => closeWorker(task, input, byName.get(name))),
    ),
    ...notices(input, worker),
  };
}

function notices(
  input: ReconcileInput,
  worker: (task: Task) => HcTerminal | undefined,
): Pick<ReconcilePlan, "notify" | "notices"> {
  const sent = new Set(input.notices);
  const fresh = input.tasks
    .flatMap((task) => [...readyNotice(task), ...staleNotice(task, input, worker(task))])
    .filter((notice) => !sent.has(notice.key));
  const ids = new Set(input.tasks.map((task) => task.meta.id));
  const kept = input.notices.filter((key) => ids.has(noticeTask(key)));
  return {
    notify: fresh.map((notice) => notice.line),
    notices: [...kept, ...fresh.map((notice) => notice.key)],
  };
}
