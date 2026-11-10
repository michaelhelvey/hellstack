import { expect, test } from "bun:test";
import { type Holds, makeHolds } from "../src/ui/holds.ts";

const ROWS = ["a", "b"];

const apply = (holds: Holds, load: number) => holds.apply(load, ROWS, (row) => row);

test.each<
  [string, (holds: Holds) => ReadonlyArray<string> | undefined, ReadonlyArray<string> | undefined]
>([
  [
    "an older load that completes after a newer load gives no rows",
    (holds) => {
      const old = holds.start();
      holds.start();
      return apply(holds, old);
    },
    undefined,
  ],
  [
    "an action in progress holds its row",
    (holds) => {
      holds.hold("a");
      return apply(holds, holds.start());
    },
    ["b"],
  ],
  [
    "a settled action holds its row from a load that started before it settled",
    (holds) => {
      const load = holds.start();
      holds.hold("a");
      holds.settle("a");
      return apply(holds, load);
    },
    ["b"],
  ],
  [
    "a load that started after the action settled shows the row",
    (holds) => {
      holds.hold("a");
      holds.settle("a");
      return apply(holds, holds.start());
    },
    ROWS,
  ],
  [
    "a released action does not hold its row",
    (holds) => {
      const load = holds.start();
      holds.hold("a");
      holds.release("a");
      return apply(holds, load);
    },
    ROWS,
  ],
])("%s", (_, scenario, expected) => {
  expect(scenario(makeHolds())).toEqual(expected);
});
