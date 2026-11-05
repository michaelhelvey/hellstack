/** The turn that the watchdog follows and the time in milliseconds when it saw it first. */
export interface WatchState {
  turn: number;
  since: number;
}

/** What the watchdog sees of the coordinator. */
export interface WatchInput {
  working: boolean;
  turn: number;
}

/** The time that one coordinator turn can work before the watchdog interrupts it, in milliseconds. */
export const STUCK_MS = 3 * 60 * 1000;

/**
 * Follows the coordinator turn. It tells to interrupt when the same turn has the status `working`
 * for more than {@link STUCK_MS}. After an interrupt, it starts to count again.
 */
export function watch(
  prev: WatchState | undefined,
  input: WatchInput,
  now: number,
): { state: WatchState | undefined; interrupt: boolean } {
  if (!input.working) return { state: undefined, interrupt: false };
  if (prev?.turn !== input.turn)
    return { state: { turn: input.turn, since: now }, interrupt: false };
  const interrupt = now - prev.since > STUCK_MS;
  return { state: interrupt ? { turn: input.turn, since: now } : prev, interrupt };
}
