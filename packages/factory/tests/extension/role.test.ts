import { describe, expect, test } from "bun:test";

import { resolveRole, ROLE_ENTRY, roleFromEnv } from "../../src/extension/role.ts";

describe("roleFromEnv", () => {
  test("reads the role and the task of a design agent", () => {
    expect(roleFromEnv({ FACTORY_ROLE: "design", FACTORY_TASK: "t-7f3a" })).toEqual({
      kind: "design",
      task: "t-7f3a",
    });
  });

  test("reads the role and the task of a worker", () => {
    expect(roleFromEnv({})).toEqual({ kind: "none" });
    expect(roleFromEnv({ FACTORY_ROLE: "" })).toEqual({ kind: "none" });
    expect(roleFromEnv({ FACTORY_ROLE: "coordinator" })).toEqual({ kind: "coordinator" });
    expect(roleFromEnv({ FACTORY_ROLE: "subagent" })).toEqual({ kind: "subagent" });
    expect(roleFromEnv({ FACTORY_ROLE: "worker", FACTORY_TASK: "t-7f3a" })).toEqual({
      kind: "worker",
      task: "t-7f3a",
    });
  });

  test("throws for an unknown role and for a worker without a valid task", () => {
    expect(() => roleFromEnv({ FACTORY_ROLE: "boss" })).toThrow("FACTORY_ROLE");
    expect(() => roleFromEnv({ FACTORY_ROLE: "worker" })).toThrow("FACTORY_TASK");
    expect(() => roleFromEnv({ FACTORY_ROLE: "worker", FACTORY_TASK: "x" })).toThrow();
    expect(() => roleFromEnv({ FACTORY_ROLE: "design" })).toThrow();
  });
});

function entry(data: unknown) {
  return { type: "custom", customType: ROLE_ENTRY, data };
}

describe("resolveRole", () => {
  test("the last valid role entry gives a session without an env role its role", () => {
    const entries = [
      entry({ kind: "design", task: "t-0001" }),
      { type: "message" },
      entry({ kind: "design", task: "t-0002" }),
      entry({ kind: "design", task: "not an id" }),
      { type: "custom", customType: "other", data: { kind: "design", task: "t-0003" } },
    ];
    expect(resolveRole({ kind: "none" }, entries)).toEqual({ kind: "design", task: "t-0002" });
    expect(resolveRole({ kind: "none" }, [])).toEqual({ kind: "none" });
  });

  test("the env role has priority over a role entry", () => {
    const entries = [entry({ kind: "design", task: "t-0001" })];
    expect(resolveRole({ kind: "coordinator" }, entries)).toEqual({ kind: "coordinator" });
  });
});
