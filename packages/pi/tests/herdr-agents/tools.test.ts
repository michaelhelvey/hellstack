import { expect, test } from "bun:test";

import { type ModelLookup, resolveModel } from "../../src/herdr-agents/tools.ts";

type Model = { provider: string; id: string; auth: boolean };

const MODELS: Model[] = [
  { provider: "claude-bridge", id: "claude-opus-5-5", auth: true },
  { provider: "anthropic", id: "claude-opus-5-5", auth: false },
  { provider: "fake", id: "org/fake-1", auth: true },
];

const registry: ModelLookup<Model> = {
  find: (provider, id) => MODELS.find((model) => model.provider === provider && model.id === id),
  hasConfiguredAuth: (model) => model.auth,
};

const CURRENT = { provider: "claude-bridge", id: "claude-opus-5-5" };

test("uses the current model when no model is requested", () => {
  expect(resolveModel(undefined, CURRENT, registry)).toBe("claude-bridge/claude-opus-5-5");
});

test("throws when there is no requested model and no current model", () => {
  expect(() => resolveModel(undefined, undefined, registry)).toThrow("You have no model.");
});

test("accepts a known model with auth", () => {
  expect(resolveModel("fake/org/fake-1", CURRENT, registry)).toBe("fake/org/fake-1");
});

test("rejects a known model without auth and names the current model", () => {
  expect(() => resolveModel("anthropic/claude-opus-5-5", CURRENT, registry)).toThrow(
    "The model `anthropic/claude-opus-5-5` is unknown or has no auth. Omit model to use your model, `claude-bridge/claude-opus-5-5`.",
  );
});

test("rejects an unknown model", () => {
  expect(() => resolveModel("nope/nope", CURRENT, registry)).toThrow("is unknown or has no auth.");
});

test("rejects a model without a provider", () => {
  expect(() => resolveModel("claude-opus-5-5", undefined, registry)).toThrow(
    "The model `claude-opus-5-5` is unknown or has no auth.",
  );
});
