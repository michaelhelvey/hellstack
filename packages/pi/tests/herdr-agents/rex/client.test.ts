import { expect, test } from "bun:test";

import type { SubagentStatus } from "../../../src/herdr-agents/provider.ts";
import { parseRexEvent } from "../../../src/herdr-agents/rex/client.ts";

function sessionEvent(event: object): string {
  return JSON.stringify({ type: "session_event", payload: { session_id: "session:1", event } });
}

function statusEvent(id: string, state: string): string {
  const payload = { id, record: { state, app: "pi" }, reason: "report" };
  const block = { block_id: "block:1", name: "program_status_changed", payload };

  return sessionEvent({ type: "block_event", payload: block });
}

test.each<[string, SubagentStatus]>([
  ["working", "working"],
  ["blocked", "blocked"],
  ["done", "done"],
  ["error", "done"],
])("a %p program status is the %p subagent state", (state, status) => {
  expect(parseRexEvent(statusEvent("", state))).toEqual({
    type: "status",
    blockId: "block:1",
    status,
  });
});

test("the status of a child record or an unknown state is not an event", () => {
  expect(parseRexEvent(statusEvent("build", "working"))).toBeUndefined();
  expect(parseRexEvent(statusEvent("", "sleeping"))).toBeUndefined();
});

test("closed blocks and windows are events, and other events are not", () => {
  const closed = sessionEvent({ type: "block_closed", payload: { block_id: "block:1" } });
  const window = sessionEvent({ type: "window_closed", payload: { window_id: "window:1" } });
  const created = sessionEvent({ type: "block_created", payload: { block_id: "block:1" } });

  expect(parseRexEvent(closed)).toEqual({ type: "block_closed", blockId: "block:1" });
  expect(parseRexEvent(window)).toEqual({ type: "window_closed", windowId: "window:1" });
  expect(parseRexEvent(created)).toBeUndefined();
  expect(parseRexEvent("not json")).toBeUndefined();
});
