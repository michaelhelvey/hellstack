import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { parseJsonOrUndefined } from "../shared/json.ts";
import { parseTodoContent, serializeTodo } from "./file-format.ts";
import { displayTodoId, parseTodoId } from "./ids.ts";
import { type Failure, type TodoSession, withTodoLock } from "./lock.ts";
import {
  clearAssignmentIfClosed,
  isTodoClosed,
  sortTodos,
  type TodoFrontMatter,
  type TodoRecord,
} from "./model.ts";

/** The default todo folder, relative to the working directory. */
export const TODO_DIR_NAME = ".pi/todos";

/** The environment variable that changes the todo folder. */
export const TODO_PATH_ENV = "PI_TODO_PATH";

/** A todo after an operation, or the reason that the operation did not complete. */
export type TodoResult = { todo: TodoRecord } | Failure;

/** The fields that an update changes. Fields that are undefined do not change. */
export type TodoPatch = { [K in "title" | "status" | "tags" | "body"]?: TodoRecord[K] | undefined };

/** The fields of a new todo. */
export interface NewTodo {
  title: string;
  tags?: string[] | undefined;
  status?: string | undefined;
  body?: string | undefined;
}

type TodoChange = Failure | "save" | "delete" | "keep";

const SettingsSchema = z
  .object({
    gc: z.boolean().catch(true),
    gcDays: z
      .number()
      .catch(7)
      .transform((days) => Math.max(0, Math.floor(days))),
  })
  .catch({ gc: true, gcDays: 7 });

/** Returns the todo folder for a working directory. `PI_TODO_PATH` overrides the default. */
export function getTodosDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[TODO_PATH_ENV]?.trim();

  return path.resolve(cwd, override || TODO_DIR_NAME);
}

/** Returns the todo folder as the tool description shows it: a relative default or an absolute override. */
export function getTodosDirLabel(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return env[TODO_PATH_ENV]?.trim() ? getTodosDir(cwd, env) : TODO_DIR_NAME;
}

function notFound(id: string): Failure {
  return { error: `Todo ${displayTodoId(id)} not found` };
}

function hasAssignmentConflict(todo: TodoRecord, sessionId: string, force: boolean): boolean {
  return Boolean(todo.assigned_to_session) && todo.assigned_to_session !== sessionId && !force;
}

function applyPatch(todo: TodoRecord, patch: TodoPatch): TodoChange {
  const defined = Object.entries(patch).filter(([, value]) => value !== undefined);
  Object.assign(todo, Object.fromEntries(defined));
  todo.created_at ||= new Date().toISOString();
  clearAssignmentIfClosed(todo);

  return "save";
}

function appendBody(todo: TodoRecord, text: string): TodoChange {
  if (!text.trim()) return "keep";
  const spacer = todo.body.trim() ? "\n\n" : "";
  todo.body = `${todo.body.replace(/\s+$/, "")}${spacer}${text.trim()}\n`;

  return "save";
}

/** Reads and changes the todo files in one folder. Each change holds the lock of the todo. */
export class TodoStore {
  /** Makes a store for the todo folder `dir`. */
  constructor(
    readonly dir: string,
    readonly session: TodoSession,
  ) {}

  /** Returns the path of the file of a todo. */
  pathFor(id: string): string {
    return path.join(this.dir, `${id}.md`);
  }

  /** Makes the todo folder if it does not exist. */
  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Returns the front matter of all todos, sorted by {@link sortTodos}. */
  async list(): Promise<TodoFrontMatter[]> {
    const entries = await readdir(this.dir).catch(() => []);
    const ids = entries.filter((entry) => entry.endsWith(".md")).map((entry) => entry.slice(0, -3));
    const todos = await Promise.all(ids.map((id) => this.read(id).catch(() => undefined)));

    return sortTodos(
      todos
        .filter((todo) => todo !== undefined)
        .map(({ body: _body, ...frontMatter }) => frontMatter),
    );
  }

  /** Returns one todo. */
  async get(rawId: string): Promise<TodoResult> {
    const id = parseTodoId(rawId);

    if (!id) return { error: "Invalid todo id. Expected TODO-<hex>." };
    const todo = await this.read(id);

    return todo ? { todo } : notFound(id);
  }

  /** Makes a new todo with a random id. */
  async create(input: NewTodo): Promise<TodoResult> {
    await this.ensureDir();

    const todo: TodoRecord = {
      id: this.generateId(),
      title: input.title,
      tags: input.tags ?? [],
      status: input.status ?? "open",
      created_at: new Date().toISOString(),
      body: input.body ?? "",
    };

    return this.withLock(todo.id, () => this.commit(todo, "save"));
  }

  /** Changes the fields of a todo. A closed todo loses its assignment. */
  update(rawId: string, patch: TodoPatch): Promise<TodoResult> {
    return this.change(rawId, (todo) => applyPatch(todo, patch));
  }

  /** Adds text to the end of the body of a todo. */
  append(rawId: string, text: string): Promise<TodoResult> {
    return this.change(rawId, (todo) => appendBody(todo, text));
  }

  /** Assigns a todo to this session. `force` takes a todo from a different session. */
  claim(rawId: string, force = false): Promise<TodoResult> {
    const sessionId = this.session.id;

    return this.change(rawId, (todo): TodoChange => {
      if (isTodoClosed(todo.status)) return { error: `Todo ${displayTodoId(todo.id)} is closed` };

      if (hasAssignmentConflict(todo, sessionId, force)) {
        return {
          error: `Todo ${displayTodoId(todo.id)} is already assigned to session ${todo.assigned_to_session}. Use force to override.`,
        };
      }

      if (todo.assigned_to_session === sessionId) return "keep";
      todo.assigned_to_session = sessionId;

      return "save";
    });
  }

  /** Removes the assignment of a todo. `force` releases a todo of a different session. */
  release(rawId: string, force = false): Promise<TodoResult> {
    const sessionId = this.session.id;

    return this.change(rawId, (todo): TodoChange => {
      if (!todo.assigned_to_session) return "keep";

      if (hasAssignmentConflict(todo, sessionId, force)) {
        return {
          error: `Todo ${displayTodoId(todo.id)} is assigned to session ${todo.assigned_to_session}. Use force to release.`,
        };
      }

      todo.assigned_to_session = undefined;

      return "save";
    });
  }

  /** Deletes the file of a todo. */
  delete(rawId: string): Promise<TodoResult> {
    return this.change(rawId, () => "delete");
  }

  /**
   * Deletes closed todos that are older than the `gcDays` setting, if the `gc` setting is on.
   * The settings are in `settings.json` in the todo folder.
   */
  async collectGarbage(): Promise<void> {
    const settings = await this.readSettings();

    if (!settings.gc) return;
    const cutoff = Date.now() - settings.gcDays * 24 * 60 * 60 * 1000;

    const expired = (await this.list()).filter(
      (todo) => isTodoClosed(todo.status) && Date.parse(todo.created_at) < cutoff,
    );

    await Promise.all(expired.map((todo) => unlink(this.pathFor(todo.id)).catch(() => undefined)));
  }

  private async readSettings(): Promise<z.infer<typeof SettingsSchema>> {
    const raw = await readFile(path.join(this.dir, "settings.json"), "utf8").catch(() => "");

    return SettingsSchema.parse(parseJsonOrUndefined(raw));
  }

  private async read(id: string): Promise<TodoRecord | undefined> {
    const filePath = this.pathFor(id);

    if (!existsSync(filePath)) return undefined;

    return parseTodoContent(await readFile(filePath, "utf8"), id);
  }

  private generateId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = crypto.randomBytes(4).toString("hex");

      if (!existsSync(this.pathFor(id))) return id;
    }

    throw new Error("Failed to generate unique todo id");
  }

  private withLock(id: string, fn: () => Promise<TodoResult>): Promise<TodoResult> {
    const lockPath = path.join(this.dir, `${id}.lock`);

    return withTodoLock({ lockPath, id, session: this.session }, fn);
  }

  private async change(
    rawId: string,
    apply: (todo: TodoRecord) => TodoChange,
  ): Promise<TodoResult> {
    const id = parseTodoId(rawId);

    if (!id) return { error: "Invalid todo id. Expected TODO-<hex>." };

    if (!existsSync(this.pathFor(id))) return notFound(id);

    return this.withLock(id, async () => {
      const todo = await this.read(id);

      return todo ? this.commit(todo, apply(todo)) : notFound(id);
    });
  }

  private async commit(todo: TodoRecord, change: TodoChange): Promise<TodoResult> {
    if (typeof change === "object") return change;

    if (change === "save") await writeFile(this.pathFor(todo.id), serializeTodo(todo), "utf8");

    if (change === "delete") await unlink(this.pathFor(todo.id));

    return { todo };
  }
}
