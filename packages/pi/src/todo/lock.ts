import { readFile, stat, unlink, writeFile } from "node:fs/promises";

import { z } from "zod";

import { parseErrorInfo } from "../shared/error-info.ts";
import { parseJsonOrUndefined } from "../shared/json.ts";
import { displayTodoId } from "./ids.ts";

/** The time after which a lock file is stale and a session can take it. */
export const LOCK_TTL_MS = 30 * 60 * 1000;

/** The session that uses the todo store. */
export interface TodoSession {
  /** The id of the session. Todo assignments use this id. */
  id: string;
  /** The session file. Lock files record this path. */
  file: string | undefined;
  /** Asks the user a yes or no question. It is undefined when no UI is available. */
  confirm: ((title: string, message: string) => Promise<boolean>) | undefined;
}

/** The lock file, the todo that it locks, and the session that wants the lock. */
export interface LockTarget {
  lockPath: string;
  id: string;
  session: TodoSession;
}

/** An operation that did not complete, with a message for the user. */
export interface Failure {
  error: string;
}

const LockInfoSchema = z.object({ session: z.string().nullish() }).catch({});

async function tryCreateLock(target: LockTarget): Promise<Failure | "exists" | undefined> {
  const info = {
    id: target.id,
    pid: process.pid,
    session: target.session.file,
    created_at: new Date().toISOString(),
  };

  try {
    await writeFile(target.lockPath, JSON.stringify(info, null, 2), { flag: "wx" });

    return undefined;
  } catch (error) {
    const { code, message } = parseErrorInfo(error);

    if (code === "EEXIST") return "exists";

    return { error: `Failed to acquire lock: ${message ?? "unknown error"}` };
  }
}

async function isLockFresh(lockPath: string): Promise<boolean> {
  const stats = await stat(lockPath).catch(() => undefined);

  return stats !== undefined && Date.now() - stats.mtimeMs <= LOCK_TTL_MS;
}

async function lockOwnerSuffix(lockPath: string): Promise<string> {
  const raw = await readFile(lockPath, "utf8").catch(() => "");
  const { session } = LockInfoSchema.parse(parseJsonOrUndefined(raw));

  return session ? ` (session ${session})` : "";
}

async function confirmSteal(target: LockTarget): Promise<Failure | undefined> {
  const todo = `Todo ${displayTodoId(target.id)}`;
  const { confirm } = target.session;

  if (!confirm) return { error: `${todo} lock is stale; rerun in interactive mode to steal it.` };
  const steal = await confirm("Todo locked", `${todo} appears locked. Steal the lock?`);

  return steal ? undefined : { error: `${todo} remains locked.` };
}

async function resolveExistingLock(target: LockTarget): Promise<Failure | undefined> {
  if (await isLockFresh(target.lockPath)) {
    const owner = await lockOwnerSuffix(target.lockPath);

    return { error: `Todo ${displayTodoId(target.id)} is locked${owner}. Try again later.` };
  }

  const failure = await confirmSteal(target);

  if (failure) return failure;
  await unlink(target.lockPath).catch(() => undefined);

  return undefined;
}

async function acquireLock(target: LockTarget): Promise<Failure | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const created = await tryCreateLock(target);

    if (created !== "exists") return created;
    const failure = await resolveExistingLock(target);

    if (failure) return failure;
  }

  return { error: `Failed to acquire lock for todo ${displayTodoId(target.id)}.` };
}

/**
 * Runs `fn` while this session has the lock file of a todo. If a lock is stale and a UI is
 * available, asks the user before it takes the lock. Returns a failure if the lock is not
 * available.
 */
export async function withTodoLock<T>(
  target: LockTarget,
  fn: () => Promise<T>,
): Promise<T | Failure> {
  const failure = await acquireLock(target);

  if (failure) return failure;

  try {
    return await fn();
  } finally {
    await unlink(target.lockPath).catch(() => undefined);
  }
}
