import { describe, expect, test } from "bun:test";

import type { CommandResult } from "../../src/core/command.ts";
import { createHc, HcError, hcRunArgs, isRunningPi, type HcTerminal } from "../../src/core/hc.ts";

function fakeHc(reply: (args: string[]) => CommandResult) {
  const calls: string[][] = [];
  const hc = createHc((program, args) => {
    expect(program).toBe("hc");
    calls.push(args);
    return Promise.resolve(reply(args));
  });
  return { hc, calls };
}

function ok(value: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify(value), stderr: "" };
}

const notFound: CommandResult = {
  code: 3,
  stdout: "",
  stderr: `${JSON.stringify({ error: { kind: "not_found", message: 'no terminal "x"' } })}\n`,
};

describe("hcRunArgs", () => {
  test("starts the program with env, labels, and no parent", () => {
    const args = hcRunArgs({
      name: "factory-t-7f3a",
      cwd: "/repo",
      argv: ["pi", "--json"],
      labels: { "herdr.space": "sp1" },
      env: { FACTORY_ROLE: "worker" },
    });
    expect(args).toEqual([
      ...["run", "--bg", "--no-parent", "--name", "factory-t-7f3a", "--cwd", "/repo"],
      ...["--label", "herdr.space=sp1", "--", "env", "FACTORY_ROLE=worker", "pi", "--json"],
    ]);
  });
});

describe("createHc", () => {
  test("puts --json after the command and parses the reply", async () => {
    const terminal = { address: "t1", name: "a", agent: "pi", cwd: "/", state: "live", turn: 0 };
    const { hc, calls } = fakeHc(() => ok({ terminals: [terminal] }));
    expect(await hc.ls()).toEqual([terminal]);
    await hc.send("t1", "- hi");
    expect(calls).toEqual([
      ["ls", "--json"],
      ["send", "--json", "t1", "--", "- hi"],
    ]);
  });

  test("get returns undefined for a terminal that does not exist", async () => {
    const { hc } = fakeHc(() => notFound);
    expect(await hc.get("x")).toBeUndefined();
  });

  test("other commands throw the hc error", async () => {
    const { hc } = fakeHc(() => notFound);
    const error = await hc.kill("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HcError);
    expect(error).toMatchObject({ kind: "not_found", message: 'hc: no terminal "x"' });
  });
});

describe("isRunningPi", () => {
  const base: HcTerminal = { address: "t1", cwd: "/", state: "live", turn: 0, agent: "pi" };

  test("is true for live pi and for env before it starts pi", () => {
    expect(isRunningPi(base)).toBe(true);
    expect(isRunningPi({ ...base, agent: "env" })).toBe(true);
  });

  test("is false for a shell or a finished terminal", () => {
    expect(isRunningPi({ ...base, agent: "zsh" })).toBe(false);
    expect(isRunningPi({ ...base, state: "finished" })).toBe(false);
  });
});
