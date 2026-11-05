import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { readIfExists, writeAtomic, type LedgerPaths } from "../core/index.ts";

/** Returns the path of the file with the process id of the running daemon. */
export function lockPath(paths: LedgerPaths): string {
  return join(paths.state, "factoryd.pid");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Returns the process id of the running daemon of the ledger, or undefined. */
export async function daemonPid(paths: LedgerPaths): Promise<number | undefined> {
  const pid = Number(await readIfExists(lockPath(paths)));
  return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : undefined;
}

/**
 * Makes this process the daemon of the ledger. Throws when another daemon runs. Returns a function
 * that releases the lock.
 */
export async function acquireLock(paths: LedgerPaths): Promise<() => Promise<void>> {
  const other = await daemonPid(paths);
  if (other !== undefined && other !== process.pid) {
    throw new Error(`factoryd runs already for ${paths.home} (pid ${other})`);
  }
  await mkdir(paths.state, { recursive: true });
  await writeAtomic(lockPath(paths), `${process.pid}\n`);
  return () => rm(lockPath(paths), { force: true });
}
