import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultConfig } from "./config.ts";
import { errorCode, readIfExists, writeAtomic, writeIfMissing } from "./files.ts";
import { ledgerPaths, promptPath, taskPath, type LedgerPaths } from "./paths.ts";
import {
  appendLogEntry,
  checkLandingItem,
  newTask,
  newTaskId,
  parseTask,
  serializeTask,
  validateHandoff,
  type Task,
  type TaskMeta,
} from "./task.ts";

/** The front matter fields that `updateTask` can change. */
export type TaskPatch = Partial<
  Pick<TaskMeta, "status" | "now" | "needs_you" | "threads" | "paused" | "title">
>;

/** The result of a handoff: the ready task, or the parts that the task needs. */
export type HandoffResult = { ok: true; task: Task } | { ok: false; missing: string[] };

/** A task file that is not valid. */
export interface InvalidTask {
  path: string;
  error: string;
}

/** The tasks of the ledger and the task files that are not valid. */
export interface TaskList {
  tasks: Task[];
  invalid: InvalidTask[];
}

/**
 * Makes the ledger folders, writes the default `config.json`, and copies the coordinator seed to
 * `COORDINATOR.md`. It does not replace files that exist. Returns the paths that it wrote.
 */
export async function initLedger(paths: LedgerPaths = ledgerPaths()): Promise<string[]> {
  await Promise.all(
    [paths.tasks, paths.inbox, paths.state].map((dir) => mkdir(dir, { recursive: true })),
  );
  const seed = await readFile(promptPath("COORDINATOR.seed.md"), "utf8");
  const files: [string, string][] = [
    [paths.config, `${JSON.stringify(defaultConfig(), null, 2)}\n`],
    [paths.coordinator, seed],
  ];
  const written = await Promise.all(files.map(([path, text]) => writeIfMissing(path, text)));
  return files.map(([path]) => path).filter((_, index) => written[index]);
}

async function readTaskFile(path: string): Promise<Task | InvalidTask> {
  try {
    return parseTask(await readFile(path, "utf8"));
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Returns all tasks of the ledger, sorted by `created`. Files that are not valid go to `invalid`. */
export async function listTasks(paths: LedgerPaths = ledgerPaths()): Promise<TaskList> {
  const names = await readdir(paths.tasks).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  });
  const files = names.filter((name) => name.endsWith(".md")).map((name) => join(paths.tasks, name));
  const results = await Promise.all(files.map(readTaskFile));
  const tasks = results.filter((result): result is Task => "meta" in result);
  tasks.sort((a, b) => a.meta.created.localeCompare(b.meta.created));
  return { tasks, invalid: results.filter((result): result is InvalidTask => "error" in result) };
}

/** Returns task `id`. Throws when it does not exist or is not valid. */
export async function getTask(id: string, paths: LedgerPaths = ledgerPaths()): Promise<Task> {
  const text = await readIfExists(taskPath(paths, id));
  if (text === undefined) throw new Error(`no task ${id}`);
  return parseTask(text);
}

/** Writes `task` atomically and sets `updated` to the current time. Returns the written task. */
export async function writeTask(task: Task, paths: LedgerPaths = ledgerPaths()): Promise<Task> {
  const written = { ...task, meta: { ...task.meta, updated: new Date().toISOString() } };
  await mkdir(paths.tasks, { recursive: true });
  await writeAtomic(taskPath(paths, task.meta.id), serializeTask(written));
  return written;
}

async function unusedTaskId(paths: LedgerPaths): Promise<string> {
  const id = newTaskId();
  return (await readIfExists(taskPath(paths, id))) === undefined ? id : unusedTaskId(paths);
}

/** The fields of a task that `createTask` makes. */
export interface CreateTask {
  title: string;
  repo: string;
}

/** Makes a `sketch` task from `prompts/task-template.md` and writes it. Returns the new task. */
export async function createTask(
  fields: CreateTask,
  paths: LedgerPaths = ledgerPaths(),
): Promise<Task> {
  const template = await readFile(promptPath("task-template.md"), "utf8");
  const id = await unusedTaskId(paths);
  return writeTask(newTask({ ...fields, id, template, now: new Date().toISOString() }), paths);
}

async function editTask(id: string, edit: (task: Task) => Task, paths: LedgerPaths): Promise<Task> {
  return writeTask(edit(await getTask(id, paths)), paths);
}

/**
 * Changes front matter fields of task `id`. Throws when the change moves a `sketch` to `ready`:
 * only {@link handoff} can do that.
 */
export async function updateTask(
  id: string,
  patch: TaskPatch,
  paths: LedgerPaths = ledgerPaths(),
): Promise<Task> {
  return editTask(
    id,
    (task) => {
      if (task.meta.status === "sketch" && patch.status === "ready") {
        throw new Error(`task ${id} is a sketch; use handoff to make it ready`);
      }
      return { ...task, meta: { ...task.meta, ...patch } };
    },
    paths,
  );
}

/** Adds the line `- <time> <who>: <text>` to the Log section of task `id`. */
export async function logTask(
  id: string,
  entry: { who: string; text: string },
  paths: LedgerPaths = ledgerPaths(),
): Promise<Task> {
  const line = `${new Date().toISOString()} ${entry.who}: ${entry.text}`;
  return editTask(id, (task) => ({ ...task, body: appendLogEntry(task.body, line) }), paths);
}

/** Checks Landing item `number` (1-based) of task `id`. */
export async function checkLanding(
  id: string,
  number: number,
  paths: LedgerPaths = ledgerPaths(),
): Promise<Task> {
  return editTask(id, (task) => ({ ...task, body: checkLandingItem(task.body, number) }), paths);
}

/**
 * Moves task `id` from `sketch` to `ready` when its contract is complete. Else it returns the parts
 * that the task needs and does not change the file.
 */
export async function handoff(
  id: string,
  paths: LedgerPaths = ledgerPaths(),
): Promise<HandoffResult> {
  const task = await getTask(id, paths);
  const missing = await validateHandoff(task);
  if (task.meta.status !== "sketch") missing.unshift(`status is ${task.meta.status}, not sketch`);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    task: await writeTask({ ...task, meta: { ...task.meta, status: "ready" } }, paths),
  };
}
