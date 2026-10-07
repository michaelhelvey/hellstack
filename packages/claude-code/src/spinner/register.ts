import { doneWord, type Random, spinnerWord } from "./words.ts";

/** The part of a `ui.render` event for a `Spinner` that this mod reads. */
export interface SpinnerRender {
  props: { word: string };
}

/** The part of a `ui.render` event for a `TurnDuration` line that this mod reads. */
export interface TurnDurationRender {
  props: { word: string; durationMs: number };
}

/** A hook with the `($, e, next)` shape of Claude Code hooks. */
export type Hook<E> = ($: unknown, e: E, next: (e: E) => unknown) => unknown;

/** The part of the Claude Code `on` function that this mod uses. */
export interface On {
  (event: "prompt.submit", hook: Hook<unknown>): void;
  (event: "ui.render", matcher: { component: "Spinner" }, hook: Hook<SpinnerRender>): void;
  (
    event: "ui.render",
    matcher: { component: "TurnDuration" },
    hook: Hook<TurnDurationRender>,
  ): void;
}

/**
 * Registers the hooks that replace the spinner word with a random one for each prompt, and the
 * word of the line at the end of each turn with a random past-tense word.
 */
export function registerWith(on: On, random: Random): void {
  let word: string | undefined;
  on("prompt.submit", (_$, e, next) => {
    word = spinnerWord(random);
    return next(e);
  });
  on("ui.render", { component: "Spinner" }, (_$, e, next) => {
    word ??= spinnerWord(random);
    return next({ ...e, props: { ...e.props, word } });
  });
  on("ui.render", { component: "TurnDuration" }, (_$, e, next) => {
    const done = doneWord(e.props.word, e.props.durationMs);
    return next({ ...e, props: { ...e.props, word: done } });
  });
}

/** Registers the spinner hooks with `Math.random`. Claude Code calls this when it loads the mod. */
export function register(on: On): void {
  registerWith(on, Math.random);
}
