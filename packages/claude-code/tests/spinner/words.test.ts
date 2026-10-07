import { expect, test } from "bun:test";

import {
  doneVerbs,
  doneWord,
  spinnerWord,
  tails,
  targets,
  verbs,
} from "../../src/spinner/words.ts";

function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

test("spinnerWord joins a verb, an object, and an ending when the coin is below one half", () => {
  expect(spinnerWord(sequence(0, 0, 0.1, 0))).toBe(`${verbs[0]} ${targets[0]} ${tails[0]}`);
});

test("spinnerWord leaves out the ending when the coin is one half or more", () => {
  expect(spinnerWord(sequence(0.999, 0.999, 0.5))).toBe(`${verbs.at(-1)} ${targets.at(-1)}`);
});

test("doneWord gives the same word for the same line every time", () => {
  expect(doneWord("Baked", 3000)).toBe(doneWord("Baked", 3000));
});

test("doneWord uses many of the past-tense words over many lines", () => {
  const words = new Set(Array.from({ length: 200 }, (_, i) => doneWord("Baked", i * 1000)));
  expect(words.size).toBeGreaterThan(doneVerbs.length / 2);
});
