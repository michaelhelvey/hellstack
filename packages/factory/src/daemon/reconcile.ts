import { workerTerminal, type HcTerminal, type Task } from "../core/index.ts";
import { runningPi } from "./route.ts";

/** What the reconciler looks at. `notices` are the keys of the notices that it sent before. */
export interface ReconcileInput {
  tasks: Task[];
  terminals: HcTerminal[];
  notices: string[];
  now: Date;
  staleAfterMinutes: number;
}

/** What the reconciler does: start workers, tell the coordinator, and remember the notices. */
export interface ReconcilePlan {
  start: Task[];
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

function noticeTask(key: string): string {
  return key.split(":")[1] ?? "";
}

/**
 * Compares the tasks with the terminals. It starts each wanted worker that does not run pi. It
 * tells the coordinator one time about each `ready` task and each stale task. It forgets the
 * notices of tasks that no longer exist.
 */
export function reconcile(input: ReconcileInput): ReconcilePlan {
  const running = runningPi(input.terminals);
  const byName = new Map(input.terminals.map((terminal) => [terminal.name, terminal]));
  const start = input.tasks.filter(
    (task) => wantsWorker(task) && !running.has(workerTerminal(task.meta.id)),
  );
  const sent = new Set(input.notices);
  const fresh = input.tasks
    .flatMap((task) => [
      ...readyNotice(task),
      ...staleNotice(task, input, byName.get(workerTerminal(task.meta.id))),
    ])
    .filter((notice) => !sent.has(notice.key));
  const ids = new Set(input.tasks.map((task) => task.meta.id));
  const kept = input.notices.filter((key) => ids.has(noticeTask(key)));
  return {
    start,
    notify: fresh.map((notice) => notice.line),
    notices: [...kept, ...fresh.map((notice) => notice.key)],
  };
}
