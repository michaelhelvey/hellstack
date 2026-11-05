import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { defaultConfig } from "./config.ts";
import { errorCode, readIfExists, withLock, writeAtomic, writeIfMissing } from "./files.ts";
import { ledgerPaths, promptPath, taskPath, type LedgerPaths } from "./paths.ts";
import {
  appendLogEntry,
  checkLandingItem,
  cwdStatuses,
  newTask,
  newTaskId,
  parseTask,
  serializeTask,
  statusTransitions,
  validateHandoff,
  type Task,
  type TaskMeta,
  type TaskStatus,
} from "./task.ts";

type PatchField = "status" | "now" | "needs_you" | "threads" | "paused" | "title" | "cwd";

/** The front matter fields that `updateTask` can change. An undefined field does not change. */
export type TaskPatch = { [K in PatchField]?: TaskMeta[K] | undefined };

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

function parseTaskFile(path: string, text: string): Task {
  const task = parseTask(text);
  const stem = basename(path, ".md");
  if (stem !== task.meta.id)
    throw new Error(`the file name ${stem} does not match the id ${task.meta.id}`);
  return task;
}

async function readTaskFile(path: string): Promise<Task | InvalidTask> {
  try {
    return parseTaskFile(path, await readFile(path, "utf8"));
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
  tasks.sort((a, b) => Date.parse(a.meta.created) - Date.parse(b.meta.created));
  return { tasks, invalid: results.filter((result): result is InvalidTask => "error" in result) };
}

/**
 * Returns task `id`. Throws when it does not exist, is not valid, or its file name is not its id.
 */
export async function getTask(id: string, paths: LedgerPaths = ledgerPaths()): Promise<Task> {
  const path = taskPath(paths, id);
  const text = await readIfExists(path);
  if (text === undefined) throw new Error(`no task ${id}`);
  return parseTaskFile(path, text);
}

/**
 * Writes `task` atomically and sets `updated` to `now` (the default is the current time). Returns
 * the written task. It does not take the task lock; the other write functions do.
 */
export async function writeTask(
  task: Task,
  paths: LedgerPaths = ledgerPaths(),
  now: string = new Date().toISOString(),
): Promise<Task> {
  const written = { ...task, meta: { ...task.meta, updated: now } };
  await mkdir(paths.tasks, { recursive: true });
  await writeAtomic(taskPath(paths, task.meta.id), serializeTask(written));
  return written;
}

/** The fields of a task that `createTask` makes. `goal` is a draft for the Goal section. */
export interface CreateTask {
  title: string;
  cwd: string;
  threads?: string[];
  goal?: string;
}

/** Makes a `sketch` task from `prompts/task-template.md` and writes it. Returns the new task. */
export async function createTask(
  fields: CreateTask,
  paths: LedgerPaths = ledgerPaths(),
): Promise<Task> {
  const template = await readFile(promptPath("task-template.md"), "utf8");
  const task = newTask({ ...fields, id: newTaskId(), template, now: new Date().toISOString() });
  await mkdir(paths.tasks, { recursive: true });
  const path = taskPath(paths, task.meta.id);
  const created = await withLock(path, async () =>
    (await readIfExists(path)) === undefined ? writeTask(task, paths) : undefined,
  );
  return created ?? createTask(fields, paths);
}

async function editTask(
  id: string,
  edit: (task: Task, now: string) => Task | Promise<Task>,
  paths: LedgerPaths,
): Promise<Task> {
  return withLock(taskPath(paths, id), async () => {
    const task = await getTask(id, paths);
    const now = new Date().toISOString();
    return writeTask(await edit(task, now), paths, now);
  });
}

function definedFields(patch: TaskPatch): Partial<Pick<TaskMeta, PatchField>> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

function allowed(from: TaskStatus, to: TaskStatus): boolean {
  return to === from || statusTransitions[from].includes(to);
}

function assertTransition(id: string, from: TaskStatus, to: TaskStatus | undefined): void {
  if (to === undefined || allowed(from, to)) return;
  throw new Error(`task ${id} cannot go from ${from} to ${to}${transitionHint(from, to)}`);
}

function transitionHint(from: TaskStatus, to: TaskStatus): string {
  return from === "sketch" && to === "ready" ? "; use handoff to make it ready" : "";
}

function assertCwd(task: Task, cwd: string | undefined): void {
  if (cwd === undefined || cwd === task.meta.cwd || cwdStatuses.includes(task.meta.status)) return;
  throw new Error(
    `task ${task.meta.id} is ${task.meta.status}; cwd can change only in sketch or ready`,
  );
}

/**
 * Changes front matter fields of task `id`. Fields that are undefined do not change. Throws when the
 * status change is not in {@link statusTransitions}: for example, only {@link handoff} moves a
 * `sketch` to `ready`. Throws when `cwd` changes and the status is not in {@link cwdStatuses}. The
 * change to `landed` sets `landed_at`.
 */
export async function updateTask(
  id: string,
  patch: TaskPatch,
  paths: LedgerPaths = ledgerPaths(),
): Promise<Task> {
  return editTask(
    id,
    (task, now) => {
      assertTransition(id, task.meta.status, patch.status);
      assertCwd(task, patch.cwd);
      const lands = patch.status === "landed" && task.meta.status !== "landed";
      const landed = lands ? { landed_at: now } : {};
      return { ...task, meta: { ...task.meta, ...definedFields(patch), ...landed } };
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

class HandoffFailed extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(missing.join("; "));
    this.missing = missing;
  }
}

async function readyTask(task: Task): Promise<Task> {
  const missing = await validateHandoff(task);
  if (task.meta.status !== "sketch") missing.unshift(`status is ${task.meta.status}, not sketch`);
  if (missing.length > 0) throw new HandoffFailed(missing);
  return { ...task, meta: { ...task.meta, status: "ready" } };
}

/**
 * Moves task `id` from `sketch` to `ready` when its contract is complete. Else it returns the parts
 * that the task needs and does not change the file.
 */
export async function handoff(
  id: string,
  paths: LedgerPaths = ledgerPaths(),
): Promise<HandoffResult> {
  try {
    return { ok: true, task: await editTask(id, readyTask, paths) };
  } catch (error) {
    if (error instanceof HandoffFailed) return { ok: false, missing: error.missing };
    throw error;
  }
}
