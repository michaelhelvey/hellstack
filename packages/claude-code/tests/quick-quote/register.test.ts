import { expect, test } from "bun:test";

import type { Message } from "../../src/quick-quote/quotes.ts";
import { type AutocompleteResult, type On, register } from "../../src/quick-quote/register.ts";

type Hook = Parameters<On>[2];

function load(): { hook: Hook; matcher: RegExp } {
  let found: { hook: Hook; matcher: RegExp } | undefined;
  register((_event, matcher, hook) => {
    found = { hook, matcher: matcher.token };
  });
  if (found === undefined) throw new Error("no hook");
  return found;
}

const messages: Message[] = [
  { role: "user", text: "why" },
  { role: "assistant", text: "The cache is stale.\n\nRetry fixes it." },
];
const engine = { session: { messages: () => Promise.resolve(messages) } };
const below: AutocompleteResult = { suggestions: [{ text: "@file" }] };

test("the hook answers only tokens that start with >", () => {
  expect(load().matcher.test(">x")).toBe(true);
  expect(load().matcher.test("x")).toBe(false);
});

test("the hook puts matching quotes before the rows below it", async () => {
  const e = { text: ">retry", token: ">retry", start: 0 };
  const out = await load().hook(engine, e, () => Promise.resolve(below));
  expect(out.suggestions).toEqual([
    { text: "> Retry fixes it.\n\n", label: "Retry fixes it." },
    { text: "@file" },
  ]);
});

test("the hook passes other drafts on unchanged", async () => {
  const e = { text: "a >x", token: ">x", start: 2 };
  expect(await load().hook(engine, e, () => Promise.resolve(below))).toBe(below);
});
