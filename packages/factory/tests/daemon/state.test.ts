import { expect, test } from "bun:test";

import { loadState, MAX_SEEN, rememberSeen, saveState, unseen } from "../../src/daemon/state.ts";
import { tempLedger } from "../core/helpers.ts";
import { event } from "./helpers.ts";

test("the state survives a restart", async () => {
  const paths = await tempLedger();
  expect(await loadState(paths)).toEqual({ cursors: {}, seen: [], notices: [] });
  const state = { cursors: { github: { since: "x" } }, seen: ["a"], notices: ["ready:t-1234"] };
  await saveState(paths, state);
  expect(await loadState(paths)).toEqual(state);
});

test("unseen drops events that were seen and repeats in one poll", () => {
  const events = [event({ id: "a" }), event({ id: "b" }), event({ id: "b" })];
  expect(unseen(events, ["a"]).map((e) => e.id)).toEqual(["b"]);
});

test("rememberSeen keeps the newest ids", () => {
  const seen = Array.from({ length: MAX_SEEN }, (_, index) => String(index));
  const next = rememberSeen(seen, ["new"]);
  expect(next).toHaveLength(MAX_SEEN);
  expect(next.at(0)).toBe("1");
  expect(next.at(-1)).toBe("new");
});
