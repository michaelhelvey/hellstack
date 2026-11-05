import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";

import { acquireLock, daemonPid, lockPath } from "../../src/daemon/lock.ts";
import { tempLedger } from "../core/helpers.ts";

test("takes the lock, and releases it", async () => {
  const paths = await tempLedger();
  const release = await acquireLock(paths);
  expect(await daemonPid(paths)).toBe(process.pid);
  await release();
  expect(await daemonPid(paths)).toBeUndefined();
});

test("takes a stale lock of a process that does not run", async () => {
  const paths = await tempLedger();
  await acquireLock(paths);
  await writeFile(lockPath(paths), "999999\n");
  await acquireLock(paths);
  expect(await readFile(lockPath(paths), "utf8")).toBe(`${process.pid}\n`);
});

test("fails when another live process has the lock", async () => {
  const paths = await tempLedger();
  await acquireLock(paths);
  await writeFile(lockPath(paths), `${process.ppid}\n`);
  const error = await acquireLock(paths).catch((e: unknown) => e);
  expect(String(error)).toContain(`pid ${process.ppid}`);
});
