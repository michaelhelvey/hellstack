import type {
  FactoryEvent,
  Hc,
  HcTerminal,
  HcTerminalDetail,
  Herdr,
} from "../../src/core/index.ts";
import { NO_WINDOW } from "../../src/core/index.ts";
import { newTask, type Task, type TaskMeta } from "../../src/core/task.ts";

/** Returns an event with `fields` set. */
export function event(fields: Partial<FactoryEvent> = {}): FactoryEvent {
  return {
    id: "gh-1-20261105T142103Z",
    source: "github",
    thread: "gh:acme/api#88",
    kind: "pr_comment",
    title: "Add the router",
    summary: "@someone: please rename x",
    url: "https://github.com/acme/api/pull/88",
    ts: "2026-11-05T14:21:03Z",
    ...fields,
  };
}

/** Returns a task with `meta` set. */
export function task(meta: Partial<TaskMeta> = {}): Task {
  const now = "2026-11-05T14:00:00.000Z";
  const base = newTask({ id: "t-7f3a", title: "Add the router", repo: "/repo", template: "", now });
  return { ...base, meta: { ...base.meta, ...meta } };
}

/** Returns a live terminal with `fields` set. */
export function terminal(fields: Partial<HcTerminal> = {}): HcTerminal {
  return {
    address: "t1",
    name: "factory-t-7f3a",
    agent: "pi",
    cwd: "/repo",
    state: "live",
    status: "idle",
    turn: 1,
    ...fields,
  };
}

/** A fake hc that records its calls. `terminals` is what `ls` returns. */
export function fakeHc(terminals: HcTerminal[] = [], detail?: Partial<HcTerminalDetail>) {
  const calls: string[] = [];
  const sent: { to: string; text: string }[] = [];
  function reply(call: string) {
    calls.push(call);
    return Promise.resolve({});
  }
  const hc: Hc = {
    ls: () => Promise.resolve(terminals),
    get: (t) => reply(`get ${t}`).then(() => detail as HcTerminalDetail | undefined),
    run: (options) => reply(`run ${options.name}`).then(() => terminal({ name: options.name })),
    send: (to, text) => {
      sent.push({ to, text });
      return reply(`send ${to}`);
    },
    interrupt: (t) => reply(`interrupt ${t}`),
    kill: (t) => reply(`kill ${t}`),
    rm: (t) => reply(`rm ${t}`),
  };
  return { hc, calls, sent };
}

/** A fake Herdr without a window. */
export const noHerdr: Herdr = {
  spaces: () => Promise.resolve(NO_WINDOW),
  rename: () => Promise.resolve(true),
};
