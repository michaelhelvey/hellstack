import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { TodoSession } from "./lock.ts";
import type { TodoRecord } from "./model.ts";
import { type TodoResult, TodoStore } from "./store.ts";

/** Makes a store in a new temporary folder. */
export async function makeStore(session: Partial<TodoSession> = {}): Promise<TodoStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-todo-test-"));
  return storeFor(dir, session);
}

/** Makes a store for an existing folder, with a different session. */
export function storeFor(dir: string, session: Partial<TodoSession> = {}): TodoStore {
  return new TodoStore(dir, { id: "session-a", file: undefined, confirm: undefined, ...session });
}

/** Returns the todo of a result, or throws the error of the result. */
export function expectTodo(result: TodoResult): TodoRecord {
  if ("error" in result) throw new Error(result.error);
  return result.todo;
}

/** Returns the error of a result, or throws if the result has a todo. */
export function expectError(result: TodoResult): string {
  if ("error" in result) return result.error;
  throw new Error(`Expected an error, got todo ${result.todo.id}`);
}
