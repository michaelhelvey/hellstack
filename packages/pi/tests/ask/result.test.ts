import { expect, test } from "bun:test";

import { resultText } from "../../src/ask/index.ts";

const answer = { question: "Which?", answer: "A" };

test("resultText gives all the answers when the user answered every question", () => {
  expect(resultText(1, [answer])).toBe(
    'User has answered your questions: "Which?"="A". You can now continue with the user\'s answers.',
  );
});

test("resultText says when the user dismissed some or all of the questions", () => {
  expect(resultText(2, [answer])).toContain("dismissed the remaining questions");
  expect(resultText(1, [])).toBe("The user dismissed the question without answering.");
});
