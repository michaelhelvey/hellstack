import { expect, test } from "bun:test";

import {
  type Hook,
  type On,
  registerWith,
  type SpinnerRender,
  type TurnDurationRender,
} from "../../src/spinner/register.ts";
import { doneVerbs } from "../../src/spinner/words.ts";

interface Hooks {
  submit: Hook<unknown>;
  spinner: Hook<SpinnerRender>;
  duration: Hook<TurnDurationRender>;
}

function load(random: () => number): Hooks {
  const hooks: Partial<Hooks> = {};
  const on = ((event: string, matcher: unknown, hook?: unknown) => {
    if (event === "prompt.submit") hooks.submit = matcher as Hook<unknown>;
    else if ((matcher as { component: string }).component === "Spinner")
      hooks.spinner = hook as Hook<SpinnerRender>;
    else hooks.duration = hook as Hook<TurnDurationRender>;
  }) as On;
  registerWith(on, random);
  return hooks as Hooks;
}

function renderSpinner(hooks: Hooks): Record<string, unknown> {
  const e = { props: { word: "Sauteing", suffix: "…", mode: "thinking" } };
  return (hooks.spinner(undefined, e, (out) => out) as { props: Record<string, unknown> }).props;
}

test("the spinner keeps one word for every frame of a turn", () => {
  let n = 0;
  const hooks = load(() => (n++ * 0.37) % 1);
  const first = renderSpinner(hooks);
  expect(renderSpinner(hooks).word).toBe(first.word);
  expect(first.word).not.toBe("Sauteing");
  expect(first.suffix).toBe("…");
  expect(first.mode).toBe("thinking");
});

test("a new prompt gives the spinner a new word", () => {
  let n = 0;
  const hooks = load(() => (n++ * 0.37) % 1);
  const before = renderSpinner(hooks).word;
  hooks.submit(undefined, { text: "hi" }, (e) => e);
  expect(renderSpinner(hooks).word).not.toBe(before);
});

test("a prompt goes on to the engine unchanged", () => {
  const hooks = load(Math.random);
  const prompt = { text: "hi" };
  expect(hooks.submit(undefined, prompt, (e) => e)).toBe(prompt);
});

test("the end-of-turn line gets a past-tense word and keeps its other props", () => {
  const hooks = load(Math.random);
  const e = { props: { word: "Baked", durationMs: 3000, onScreen: null } };
  const out = hooks.duration(undefined, e, (x) => x) as { props: Record<string, unknown> };
  expect(doneVerbs).toContain(out.props.word as string);
  expect(out.props.durationMs).toBe(3000);
  expect(out.props.onScreen).toBeNull();
});
