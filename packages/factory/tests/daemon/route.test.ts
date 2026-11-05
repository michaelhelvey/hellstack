import { describe, expect, test } from "bun:test";

import { eventLine, INBOX, ownedInbox, routeEvent, runningPi } from "../../src/daemon/route.ts";
import { event, task, terminal } from "./helpers.ts";

const owned = task({ status: "working", threads: ["gh:acme/api#88"] });

describe("route", () => {
  test("an owned event goes to the worker when it runs pi and the task is not paused", () => {
    const running = runningPi([terminal()]);
    expect(routeEvent(event(), [owned], running)).toEqual([
      { to: "factory-t-7f3a", event: event(), task: "t-7f3a" },
    ]);
  });

  test("an owned event goes to the coordinator when the worker does not run pi or is paused", () => {
    const shell = runningPi([terminal({ agent: "zsh" })]);
    expect(routeEvent(event(), [owned], shell)[0]?.to).toBe("factory");
    const paused = { ...owned, meta: { ...owned.meta, paused: true } };
    expect(routeEvent(event(), [paused], runningPi([terminal()]))[0]?.to).toBe("factory");
  });

  test("an event that no task owns goes to the inbox", () => {
    expect(routeEvent(event({ thread: "gh:acme/api#1" }), [owned], new Set())).toEqual([
      { to: INBOX, event: event({ thread: "gh:acme/api#1" }) },
    ]);
  });

  test("each task that owns the thread gets the event", () => {
    const other = task({ id: "t-9b21", threads: ["gh:acme/api#88"] });
    const routes = routeEvent(event(), [owned, other], runningPi([terminal()]));
    expect(routes.map((route) => [route.to, route.task])).toEqual([
      ["factory-t-7f3a", "t-7f3a"],
      ["factory", "t-9b21"],
    ]);
  });

  test("the message line has the event and its owner", () => {
    expect(eventLine({ to: "factory", event: event(), task: "t-7f3a" })).toBe(
      '- event gh-1-20261105T142103Z gh:acme/api#88 pr_comment "@someone: please rename x" https://github.com/acme/api/pull/88 (task t-7f3a)',
    );
  });

  test("inbox events whose thread a task owns now are removed", () => {
    const inbox = [event({ id: "a" }), event({ id: "b", thread: "gh:acme/api#1" })];
    expect(ownedInbox(inbox, [owned])).toEqual(["a"]);
  });
});
