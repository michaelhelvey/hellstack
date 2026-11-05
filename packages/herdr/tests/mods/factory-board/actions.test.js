import { describe, expect, test } from "bun:test";

import {
  Actions,
  COMMANDS,
  cliResult,
  dismissText,
  powerState,
} from "../../../config/mods/factory-board/actions.js";

function runner(results) {
  const calls = [];
  async function runCli(args) {
    calls.push(args);
    return results.shift() ?? { ok: true, text: "" };
  }
  return { calls, runCli };
}

describe("power", () => {
  test("the state tells if factoryd and the coordinator run", () => {
    expect(powerState({ factoryd: true, coordinator: true })).toBe("running");
    expect(powerState({ factoryd: true, coordinator: false })).toBe("partial");
    expect(powerState({ factoryd: false, coordinator: true })).toBe("partial");
    expect(powerState({ factoryd: false, coordinator: false })).toBe("stopped");
    expect(powerState(null)).toBe("unknown");
  });
});

describe("commands", () => {
  test("a dismiss and a design of a thread use its newest event", () => {
    expect(COMMANDS.dismiss(["e2", "e1"])).toEqual(["inbox", "dismiss", "e2", "--json"]);
    expect(COMMANDS.design(["e2", "e1"])).toEqual(["inbox", "design", "e2", "--json"]);
    expect(COMMANDS.open("t-1")).toEqual(["open", "t-1", "--json"]);
  });

  test("the confirm button names what the dismiss does at the source", () => {
    expect(dismissText("github").confirm).toBe("mark done on GitHub");
    expect(dismissText("sentry").confirm).toBe("resolve in Sentry");
    expect(dismissText("jira").confirm).toBe("remove from the inbox");
  });

  test("a failed run gives its error output; a good run gives the message of its JSON", () => {
    expect(cliResult({ code: 1, stdout: "", stderr: "no such event\n" })).toEqual({
      ok: false,
      text: "no such event",
    });
    const json = JSON.stringify({ ok: false, error: "the inbox has no event e9" });
    expect(cliResult({ code: 1, stdout: json, stderr: "" }).text).toBe("the inbox has no event e9");
    expect(cliResult({ code: 2, stdout: "", stderr: "" }).text).toBe("the factory CLI exited 2");
    const note = JSON.stringify({ terminal: null, message: "no design agent runs" });
    expect(cliResult({ code: 0, stdout: note, stderr: "" })).toEqual({
      ok: true,
      text: "no design agent runs",
    });
    expect(cliResult({ code: 0, stdout: "started\n", stderr: "" })).toEqual({ ok: true, text: "" });
    const none = JSON.stringify({ terminal: null, started: false });
    expect(cliResult({ code: 0, stdout: none, stderr: "" }).text).toBe("nothing to open");
  });
});

describe("Actions", () => {
  test("an action is busy while it runs and has no state when it succeeds", async () => {
    const { calls, runCli } = runner([]);
    const actions = new Actions(runCli);
    const run = actions.run("power", "up", COMMANDS.up());
    expect(actions.get("power")).toEqual({ phase: "busy", kind: "up", text: "starting…" });
    expect(await run).toBe(true);
    expect(actions.get("power")).toBeUndefined();
    expect(calls).toEqual([["up"]]);
  });

  test("the error of a failed action stays", async () => {
    const { runCli } = runner([{ ok: false, text: "gh: 404" }]);
    const actions = new Actions(runCli);
    expect(await actions.run("thread:x", "dismiss", COMMANDS.dismiss(["a", "b"]))).toBe(false);
    expect(actions.get("thread:x")).toEqual({ phase: "error", kind: "dismiss", text: "gh: 404" });
  });

  test("a second click while the action runs does nothing", async () => {
    const { calls, runCli } = runner([]);
    const actions = new Actions(runCli);
    const first = actions.run("task:t-1", "open", COMMANDS.open("t-1"));
    expect(await actions.run("task:t-1", "open", COMMANDS.open("t-1"))).toBe(false);
    await first;
    expect(calls).toHaveLength(1);
  });

  test("a confirm step shows until it is cleared; a note stays after a good run", async () => {
    const actions = new Actions(runner([{ ok: true, text: "nothing to open" }]).runCli);
    actions.ask("thread:x", "dismiss");
    expect(actions.get("thread:x")?.phase).toBe("confirm");
    actions.clear("thread:x");
    expect(actions.get("thread:x")).toBeUndefined();
    await actions.run("task:t-1", "open", COMMANDS.open("t-1"));
    expect(actions.get("task:t-1")).toEqual({
      phase: "note",
      kind: "open",
      text: "nothing to open",
    });
  });
});
