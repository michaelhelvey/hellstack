import { expect, test } from "bun:test";

import { DIGEST_MS, emptyDigest, flushDigest, queueLines } from "../../src/daemon/digest.ts";

test("sends at most one block each 30 seconds", () => {
  const first = flushDigest(queueLines(emptyDigest(), ["- a", "- b"]), 1000);
  expect(first.block).toBe('<factory from="factoryd">\n- a\n- b\n</factory>');
  expect(first.digest).toEqual({ lines: [], lastSent: 1000 });
  const waiting = flushDigest(queueLines(first.digest, ["- c"]), 1000 + DIGEST_MS - 1);
  expect(waiting.block).toBeUndefined();
  expect(waiting.digest.lines).toEqual(["- c"]);
  expect(flushDigest(waiting.digest, 1000 + DIGEST_MS).block).toContain("- c");
});

test("sends nothing when no lines wait", () => {
  expect(flushDigest(emptyDigest(), 1000).block).toBeUndefined();
});
