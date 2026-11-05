import { expect, test } from "bun:test";

import {
  DIGEST_MS,
  emptyDigest,
  flushDigest,
  MAX_DIGEST_LINES,
  queueLines,
} from "../../src/daemon/digest.ts";

test("sends at most one block each 30 seconds", () => {
  const first = flushDigest(queueLines(emptyDigest(), ["- a", "- b"]), 1000);
  expect(first.block).toBe('<factory from="factoryd">\n- a\n- b\n</factory>');
  expect(first.digest).toEqual({ lines: [], dropped: 0, lastSent: 1000 });
  const waiting = flushDigest(queueLines(first.digest, ["- c"]), 1000 + DIGEST_MS - 1);
  expect(waiting.block).toBeUndefined();
  expect(waiting.digest.lines).toEqual(["- c"]);
  expect(flushDigest(waiting.digest, 1000 + DIGEST_MS).block).toContain("- c");
});

test("keeps the newest lines and tells how many it dropped", () => {
  const lines = Array.from({ length: MAX_DIGEST_LINES + 3 }, (_, index) => `- ${index}`);
  const digest = queueLines(queueLines(emptyDigest(), lines.slice(0, 10)), lines.slice(10));
  expect(digest.lines).toHaveLength(MAX_DIGEST_LINES);
  const block = flushDigest(digest, 0).block?.split("\n") ?? [];
  expect(block.slice(1, 3)).toEqual([
    "- 3 older lines were dropped; read the inbox and the feed",
    "- 3",
  ]);
});

test("sends nothing when no lines wait", () => {
  expect(flushDigest(emptyDigest(), 1000).block).toBeUndefined();
});
