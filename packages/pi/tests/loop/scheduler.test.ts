import { expect, test } from "bun:test";

import { Scheduler } from "../../src/loop/scheduler.ts";

function scheduler() {
  const sent: string[] = [];
  return { sent, scheduler: new Scheduler((prompt) => sent.push(JSON.stringify(prompt))) };
}

test("a run that the user sealed with /loop cannot cancel the loop that replaced it", async () => {
  const { sent, scheduler: loop } = scheduler();
  let idle = false;
  const ctx = { isIdle: () => idle };
  loop.startSelfPaced();
  loop.onRunStart();
  loop.stopAll();
  loop.scheduleWakeup(0, "replacement", ctx);

  expect(loop.requestCancel()).toContain("Not cancelled");
  expect(loop.requestWakeup(60, "old loop", ctx)).toContain("Not scheduled");
  loop.onRunSettled();
  idle = true;
  await Bun.sleep(1100);
  expect(sent).toEqual(['"replacement"']);
});

test("a run that is not sealed can schedule and cancel its wakeup", () => {
  const { scheduler: loop } = scheduler();
  loop.onRunStart();
  expect(loop.requestWakeup(60, "next", { isIdle: () => true })).toContain("scheduled in 60s");
  expect(loop.requestCancel()).toBe("Wakeup cancelled.");
  expect(loop.requestCancel()).toBe("No wakeup.");
});
