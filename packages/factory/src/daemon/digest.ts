/** The minimum time between two messages to the coordinator, in milliseconds. */
export const DIGEST_MS = 30_000;

/** The maximum count of lines that wait for the coordinator. Older lines are dropped. */
export const MAX_DIGEST_LINES = 50;

/**
 * The lines that wait for the coordinator, the count of lines that were dropped, and the time of the
 * last message, in milliseconds.
 */
export interface Digest {
  lines: string[];
  dropped: number;
  lastSent: number;
}

/** Returns an empty digest that can send at once. */
export function emptyDigest(): Digest {
  return { lines: [], dropped: 0, lastSent: Number.NEGATIVE_INFINITY };
}

/** Returns one tagged message block with the lines. */
export function factoryBlock(lines: string[]): string {
  return ['<factory from="factoryd">', ...lines, "</factory>"].join("\n");
}

/** Returns the digest with `lines` added at the end. It keeps the newest {@link MAX_DIGEST_LINES}. */
export function queueLines(digest: Digest, lines: string[]): Digest {
  const all = [...digest.lines, ...lines];
  const dropped = Math.max(0, all.length - MAX_DIGEST_LINES);
  return { ...digest, lines: all.slice(dropped), dropped: digest.dropped + dropped };
}

function droppedLine(dropped: number): string[] {
  return dropped > 0 ? [`- ${dropped} older lines were dropped; read the inbox and the feed`] : [];
}

/**
 * Returns the block to send now and the next digest. It sends when lines wait and
 * {@link DIGEST_MS} passed since the last message.
 */
export function flushDigest(digest: Digest, now: number): { digest: Digest; block?: string } {
  if (digest.lines.length === 0 || now - digest.lastSent < DIGEST_MS) return { digest };
  const block = factoryBlock([...droppedLine(digest.dropped), ...digest.lines]);
  return { digest: { lines: [], dropped: 0, lastSent: now }, block };
}
