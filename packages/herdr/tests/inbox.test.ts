import { expect, test } from "bun:test";
import { LABELS } from "../src/agents.ts";
import { Inbox, type News } from "../src/inbox.ts";

const PARENT = "t1";
const CHILD = "t2";

const child = {
  address: CHILD,
  labels: { [LABELS.parent]: PARENT, [LABELS.name]: "helper" },
  cwd: "/work",
  state: "live",
};

const setup = () => {
  const delivered: Array<News> = [];
  const inbox = new Inbox(PARENT, (news) => delivered.push(news));
  inbox.track(child, true);
  return { inbox, delivered };
};

const status = (state: string, msg = "") => ({
  type: "status",
  terminal: CHILD,
  data: { status: { state, msg } },
});
const turnEnd = { type: "turn", terminal: CHILD, data: { state: "done", turn: 1 } };
const finished = { type: "finished", terminal: CHILD, data: { exit_code: 0, reason: "exited" } };

test("a turn that ends without a report is news, and a turn after a done report is not", () => {
  const { inbox, delivered } = setup();

  inbox.apply(status("working"));
  inbox.apply(turnEnd);
  inbox.apply(status("working"));
  inbox.report(CHILD, { status: "done", summary: "fixed it\nmore detail" });
  inbox.apply(turnEnd);

  expect(delivered.map((n) => n.event)).toEqual(["idle", "done"]);
  expect(inbox.anyBusy()).toBe(false);
  expect(inbox.lines()).toEqual([`helper (${CHILD}): working - fixed it`]);
});

test("a progress report keeps the parent waiting for the subagent", () => {
  const { inbox, delivered } = setup();

  inbox.report(CHILD, { status: "progress", summary: "half done" });

  expect(delivered.map((n) => n.event)).toEqual(["progress"]);
  expect(inbox.anyBusy()).toBe(true);
});

test("a waiting call gets the news instead of the message delivery", async () => {
  const { inbox, delivered } = setup();

  const waiting = inbox.next(5000);
  inbox.apply(status("blocked", "permission"));

  expect((await waiting).map((n) => n.text)).toEqual([
    "It is blocked: permission. Read its screen with agent_read.",
  ]);
  expect(delivered).toEqual([]);
});

test("the exit of a subagent that the parent stops is not news", () => {
  const { inbox, delivered } = setup();

  inbox.markStopping(CHILD);
  inbox.apply(finished);

  expect(delivered).toEqual([]);
  expect(inbox.has(CHILD)).toBe(false);
});

test("ignores terminals of other parents and events of unknown terminals", () => {
  const { inbox, delivered } = setup();

  inbox.track({ ...child, address: "t9", labels: { [LABELS.parent]: "t8" } }, true);
  inbox.apply({ ...finished, terminal: "t9" });

  expect(inbox.has("t9")).toBe(false);
  expect(delivered).toEqual([]);
});
