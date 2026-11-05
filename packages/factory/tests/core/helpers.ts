import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "bun:test";

import { ledgerPaths, type LedgerPaths } from "../../src/core/paths.ts";

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

/** Makes a temporary folder that is removed after the test. */
export async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "factory-test-"));
  folders.push(folder);
  return folder;
}

/** Returns the paths of a ledger in a temporary folder. */
export async function tempLedger(): Promise<LedgerPaths> {
  return ledgerPaths(await tempFolder());
}

/** A task body with a complete contract and two Landing items. */
export const completeBody = `
## Goal

The router sends events to workers.

## Verification

bun test packages/factory/tests

## Output

A PR.

## Constraints

None.

## Landing

<!-- - [ ] an example in a comment -->
- [x] PR opened
- [ ] merged

## Notes

Unknown sections stay.

## Log

- 2026-11-05T15:12:00.000Z worker: opened PR #88
`;
