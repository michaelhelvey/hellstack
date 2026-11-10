/**
 * Keeps the rows of actions out of loads that can have old data. An action holds its row until a
 * load that started after the action completed. Only the newest load can give rows.
 */
export interface Holds {
  /** Starts a load and gives its number. */
  readonly start: () => number;
  /** Holds the row of an action that starts. */
  readonly hold: (key: string) => void;
  /** Holds the row until a load that starts after now. Use it when the action succeeds. */
  readonly settle: (key: string) => void;
  /** Stops the hold at once. Use it when the action fails. */
  readonly release: (key: string) => void;
  /**
   * Gives the rows of load `load` without the held rows. Gives `undefined` if a newer load started,
   * because the newer load replaces this load.
   */
  readonly apply: <A>(
    load: number,
    rows: ReadonlyArray<A>,
    key: (row: A) => string,
  ) => ReadonlyArray<A> | undefined;
}

/**
 * Makes an empty `Holds`.
 *
 * @example
 * ```ts
 * const holds = makeHolds();
 * const load = holds.start();
 * holds.hold("github:1");
 * holds.settle("github:1");
 * holds.apply(load, ["github:1", "github:2"], (key) => key);
 * // ["github:2"]
 * ```
 */
export const makeHolds = (): Holds => {
  const lastStaleLoad = new Map<string, number>();
  let loads = 0;

  const prune = (load: number) => {
    for (const [key, last] of lastStaleLoad) {
      if (last < load) lastStaleLoad.delete(key);
    }
  };

  return {
    start: () => ++loads,
    hold: (key) => lastStaleLoad.set(key, Infinity),
    settle: (key) => lastStaleLoad.set(key, loads),
    release: (key) => lastStaleLoad.delete(key),
    apply: (load, rows, key) => {
      if (load !== loads) return undefined;
      prune(load);
      return rows.filter((row) => !lastStaleLoad.has(key(row)));
    },
  };
};
