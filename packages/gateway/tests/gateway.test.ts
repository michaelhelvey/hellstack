import { expect, test } from "bun:test";

import { planGateway, setupCommand } from "../src/gateway.ts";

const auth = JSON.stringify({ token: "secret-token", gatewayUrl: "https://example.com" });

test("planGateway does nothing without an auth file", () => {
  expect(planGateway(undefined, undefined)).toEqual({ kind: "none" });
});

test("planGateway runs the setup when the settings file does not exist", () => {
  expect(planGateway(auth, undefined)).toEqual({
    kind: "setup",
    command: [...setupCommand, "secret-token"],
  });
});

test("planGateway is ready when the settings hold the token", () => {
  const settings = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: "https://example.com/api/anthropic",
      ANTHROPIC_CUSTOM_HEADERS: "x-t4-aig-token: secret-token",
      OTHER: "value",
    },
  });
  expect(planGateway(auth, settings)).toEqual({ kind: "ready" });
});

test("planGateway runs the setup when the settings hold a different token", () => {
  const settings = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: "https://example.com/api/anthropic",
      ANTHROPIC_CUSTOM_HEADERS: "x-t4-aig-token: old-token",
    },
  });
  expect(planGateway(auth, settings)).toEqual({
    kind: "setup",
    command: [...setupCommand, "secret-token"],
  });
});

test("planGateway runs the setup when the settings have no gateway environment", () => {
  expect(planGateway(auth, JSON.stringify({ env: { OTHER: "value" } }))).toEqual({
    kind: "setup",
    command: [...setupCommand, "secret-token"],
  });
});
