import { describe, expect, test } from "bun:test";

import type { FactoryEvent } from "../../src/core/index.ts";
import type { Passed } from "../../src/daemon/filter.ts";
import { eventLine, INBOX, ownedInbox, routeEvent, runningPi } from "../../src/daemon/route.ts";
import { event, task, terminal } from "./helpers.ts";

function inbox(e: FactoryEvent): Passed {
  return { event: e, action: "inbox" };
}

const owned = task({ status: "working", threads: ["gh:acme/api#88"] });

describe("route", () => {
  test("an owned event goes to the worker when it runs pi and the task is not paused", () => {
    const running = runningPi([terminal()]);
    expect(routeEvent(inbox(event()), [owned], running)).toEqual([
      { to: "factory-t-7f3a", event: event(), task: "t-7f3a", wake: false },
    ]);
  });

  test("an owned event goes to the coordinator when the worker does not run pi or is paused", () => {
    const shell = runningPi([terminal({ agent: "zsh" })]);
    expect(routeEvent(inbox(event()), [owned], shell)[0]).toMatchObject({
      to: "factory",
      wake: true,
    });
    const paused = { ...owned, meta: { ...owned.meta, paused: true } };
    expect(routeEvent(inbox(event()), [paused], runningPi([terminal()]))[0]).toMatchObject({
      to: "factory",
      wake: true,
    });
  });

  test("an event that no task owns goes to the inbox and wakes the coordinator only for wake", () => {
    const free = event({ thread: "gh:acme/api#1" });
    expect(routeEvent(inbox(free), [owned], new Set())).toEqual([
      { to: INBOX, event: free, wake: false },
    ]);
    expect(routeEvent({ event: free, action: "wake" }, [owned], new Set())).toEqual([
      { to: INBOX, event: free, wake: true },
    ]);
  });

  test("each task that owns the thread gets the event", () => {
    const other = task({ id: "t-9b21", threads: ["gh:acme/api#88"] });
    const routes = routeEvent(inbox(event()), [owned, other], runningPi([terminal()]));
    expect(routes.map((route) => [route.to, route.task])).toEqual([
      ["factory-t-7f3a", "t-7f3a"],
      ["factory", "t-9b21"],
    ]);
  });

  test("the message line has the event and its owner", () => {
    expect(eventLine({ to: "factory", event: event(), task: "t-7f3a", wake: true })).toBe(
      '- event gh-1-20261105T142103Z gh:acme/api#88 pr_comment "@someone: please rename x" https://github.com/acme/api/pull/88 (task t-7f3a)',
    );
  });

  test("inbox events whose thread a task owns now are removed", () => {
    const inbox = [event({ id: "a" }), event({ id: "b", thread: "gh:acme/api#1" })];
    expect(ownedInbox(inbox, [owned])).toEqual(["a"]);
  });
});
