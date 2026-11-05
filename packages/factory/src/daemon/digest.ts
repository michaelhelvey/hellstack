/** The minimum time between two messages to the coordinator, in milliseconds. */
export const DIGEST_MS = 30_000;

/** The lines that wait for the coordinator and the time of the last message, in milliseconds. */
export interface Digest {
  lines: string[];
  lastSent: number;
}

/** Returns an empty digest that can send at once. */
export function emptyDigest(): Digest {
  return { lines: [], lastSent: Number.NEGATIVE_INFINITY };
}

/** Returns one tagged message block with the lines. */
export function factoryBlock(lines: string[]): string {
  return ['<factory from="factoryd">', ...lines, "</factory>"].join("\n");
}

/** Returns the digest with `lines` added at the end. */
export function queueLines(digest: Digest, lines: string[]): Digest {
  return { ...digest, lines: [...digest.lines, ...lines] };
}

/**
 * Returns the block to send now and the next digest. It sends when lines wait and
 * {@link DIGEST_MS} passed since the last message.
 */
export function flushDigest(digest: Digest, now: number): { digest: Digest; block?: string } {
  if (digest.lines.length === 0 || now - digest.lastSent < DIGEST_MS) return { digest };
  return { digest: { lines: [], lastSent: now }, block: factoryBlock(digest.lines) };
}
