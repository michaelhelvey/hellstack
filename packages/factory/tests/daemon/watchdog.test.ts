import { expect, test } from "bun:test";

import { STUCK_MS, watch } from "../../src/daemon/watchdog.ts";

test("interrupts when the same turn works for more than 3 minutes", () => {
  const first = watch(undefined, { working: true, turn: 4 }, 0);
  expect(first).toEqual({ state: { turn: 4, since: 0 }, interrupt: false });
  expect(watch(first.state, { working: true, turn: 4 }, STUCK_MS).interrupt).toBe(false);
  const stuck = watch(first.state, { working: true, turn: 4 }, STUCK_MS + 1);
  expect(stuck).toEqual({ state: { turn: 4, since: STUCK_MS + 1 }, interrupt: true });
});

test("a new turn or an idle coordinator starts the count again", () => {
  const first = watch(undefined, { working: true, turn: 4 }, 0);
  expect(watch(first.state, { working: true, turn: 5 }, STUCK_MS + 1)).toEqual({
    state: { turn: 5, since: STUCK_MS + 1 },
    interrupt: false,
  });
  expect(watch(first.state, { working: false, turn: 4 }, STUCK_MS + 1)).toEqual({
    state: undefined,
    interrupt: false,
  });
});
