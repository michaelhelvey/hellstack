import { loadConfig } from "../core/config.ts";
import { listInbox, removeInbox } from "../core/inbox.ts";
import {
  checkLanding,
  createTask,
  getTask,
  handoff,
  listTasks,
  logTask,
  updateTask,
  type TaskPatch,
} from "../core/ledger.ts";
import { taskPath, type LedgerPaths } from "../core/paths.ts";
import { startWorker, workerTerminal, type SpawnDeps } from "../core/spawn.ts";
import { landingProgress, serializeTask, type Task } from "../core/task.ts";
import type { Role } from "./role.ts";
import type { InboxParams, TaskParams } from "./schemas.ts";

/** The session role and the ledger that a tool call acts on. */
export interface ActionContext {
  role: Role;
  paths: LedgerPaths;
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function ownTask(role: Extract<Role, { kind: "worker" }>, id: string | undefined): string {
  if (id !== undefined && id !== role.task) {
    throw new Error(`a worker acts only on its own task ${role.task}, not ${id}`);
  }
  return role.task;
}

/**
 * Returns the task id that a call acts on. A worker acts only on its own task. A design session
 * acts on its own task when the call does not give an id.
 */
export function targetTask(role: Role, id: string | undefined): string {
  if (role.kind === "worker") return ownTask(role, id);
  return required(id ?? (role.kind === "design" ? role.task : undefined), "id");
}

function notWorker(role: Role, action: string): void {
  if (role.kind === "worker") throw new Error(`a worker cannot ${action} tasks`);
}

/** Returns one line that tells the state of `task`. */
export function taskLine(task: Task): string {
  const { id, status, title, now, needs_you, paused } = task.meta;
  const { done, total } = landingProgress(task.body);
  const parts = [`${id} [${status}] ${title}`, `landing ${done}/${total}`];
  if (now) parts.push(`now: ${now}`);
  if (needs_you) parts.push(`needs you: ${needs_you}`);
  if (paused) parts.push("paused");
  return parts.join(" | ");
}

function describe(task: Task, paths: LedgerPaths): string {
  return `${taskLine(task)}\nfile: ${taskPath(paths, task.meta.id)}`;
}

async function listAction(ctx: ActionContext): Promise<string> {
  notWorker(ctx.role, "list");
  const { tasks, invalid } = await listTasks(ctx.paths);
  const lines = tasks.map(taskLine);
  lines.push(...invalid.map((bad) => `NOT VALID ${bad.path}: ${bad.error}`));
  return lines.length > 0 ? lines.join("\n") : "There are no tasks.";
}

async function getAction(ctx: ActionContext, params: TaskParams): Promise<string> {
  const task = await getTask(targetTask(ctx.role, params.id), ctx.paths);
  return `file: ${taskPath(ctx.paths, task.meta.id)}\n\n${serializeTask(task)}`;
}

async function createAction(ctx: ActionContext, params: TaskParams): Promise<string> {
  notWorker(ctx.role, "create");
  const fields = { title: required(params.title, "title"), repo: required(params.repo, "repo") };
  const task = await createTask(fields, ctx.paths);
  return `Created the sketch ${describe(task, ctx.paths)}\nWrite the contract into the file.`;
}

/** Returns the front matter change of an `update` call. An empty `needs_you` clears it. */
export function taskPatch(params: TaskParams): TaskPatch {
  const { status, now, threads, paused, title } = params;
  const needs_you = params.needs_you === "" ? null : params.needs_you;
  const patch = { status, now, threads, paused, title, needs_you };
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new Error("update needs at least one field to change");
  }
  return patch;
}

async function updateAction(ctx: ActionContext, params: TaskParams): Promise<string> {
  const id = targetTask(ctx.role, params.id);
  return `Updated ${describe(await updateTask(id, taskPatch(params), ctx.paths), ctx.paths)}`;
}

async function logAction(ctx: ActionContext, params: TaskParams): Promise<string> {
  const id = targetTask(ctx.role, params.id);
  const entry = { who: ctx.role.kind, text: required(params.text, "text") };
  return `Logged on ${describe(await logTask(id, entry, ctx.paths), ctx.paths)}`;
}

async function checkAction(ctx: ActionContext, params: TaskParams): Promise<string> {
  const id = targetTask(ctx.role, params.id);
  const task = await checkLanding(id, required(params.item, "item"), ctx.paths);
  return `Checked Landing item ${params.item} of ${describe(task, ctx.paths)}`;
}

const taskActions: Record<
  TaskParams["action"],
  (ctx: ActionContext, params: TaskParams) => Promise<string>
> = {
  list: listAction,
  get: getAction,
  create: createAction,
  update: updateAction,
  log: logAction,
  check: checkAction,
};

/** Runs one `factory_task` call. Returns the text for the agent. Throws when the call fails. */
export function runTaskAction(ctx: ActionContext, params: TaskParams): Promise<string> {
  return taskActions[params.action](ctx, params);
}

/** Runs one `factory_inbox` call. Returns the text for the agent. */
export async function runInboxAction(paths: LedgerPaths, params: InboxParams): Promise<string> {
  if (params.action === "dismiss") {
    await removeInbox(required(params.id, "id"), paths);
    return `Dismissed ${params.id}.`;
  }
  const events = await listInbox(paths);
  const lines = events.map((e) => `${e.id} ${e.ts} ${e.thread} ${e.kind} "${e.title}" ${e.url}`);
  return lines.length > 0 ? lines.join("\n") : "The inbox is empty.";
}

/**
 * Moves the `sketch` task to `ready` (see {@link handoff}). Throws an error that names the missing
 * parts when the contract is not complete.
 */
export async function runHandoff(ctx: ActionContext, id: string | undefined): Promise<string> {
  const result = await handoff(targetTask(ctx.role, id), ctx.paths);
  if (!result.ok) throw new Error(`handoff failed:\n- ${result.missing.join("\n- ")}`);
  return `Handoff done: ${describe(result.task, ctx.paths)}`;
}

/**
 * Starts the worker of the `ready` task `id` and sets the task to `working`. `deps` replaces the
 * spawn dependencies in tests.
 */
export async function runDispatch(
  paths: LedgerPaths,
  id: string,
  deps: Partial<SpawnDeps> = {},
): Promise<string> {
  const task = await getTask(id, paths);
  if (task.meta.status !== "ready") throw new Error(`task ${id} is ${task.meta.status}, not ready`);
  const started = await startWorker(task, await loadConfig(paths), {
    restart: false,
    deps: { ...deps, paths },
  });
  await updateTask(id, { status: "working", now: "the worker started" }, paths);
  await logTask(id, { who: "coordinator", text: `dispatched to ${workerTerminal(id)}` }, paths);
  return `Started ${started.terminal.name ?? workerTerminal(id)} (Herdr: ${started.herdr}). Task ${id} is working.`;
}
