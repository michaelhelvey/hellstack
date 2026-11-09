import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { DONE, OTHER } from "../src/ask-user-question.ts";
import { PiSandbox } from "./pi.ts";
import type { UiAnswer, UiRequest } from "./rpc.ts";

setDefaultTimeout(30_000);

let sandbox: PiSandbox;

beforeEach(async () => {
  sandbox = await PiSandbox.create();
});

afterEach(() => sandbox.dispose());

const options = [{ label: "Red", description: "warm" }, { label: "Blue" }, { label: "Green" }];

/** Asks the questions, answers each dialog with the next answer, and returns the tool result. */
const ask = async (questions: Array<Record<string, unknown>>, answers: Array<UiAnswer>) => {
  const pi = sandbox.rpc();
  const dialogs: Array<UiRequest> = [];
  pi.onDialog((request) => {
    dialogs.push(request);
    return answers.shift() ?? { cancelled: true };
  });
  sandbox.model.callTools({ name: "ask_user_question", arguments: { questions } });
  const [result] = await pi.prompt("ask me");
  return { result, dialogs };
};

test("returns the label of the option that the user selects", async () => {
  const { result, dialogs } = await ask(
    [{ question: "Which color?", header: "Color", options }],
    [{ value: "2. Blue" }],
  );

  expect(dialogs[0]).toMatchObject({
    method: "select",
    title: "Color: Which color?",
    options: ["1. Red - warm", "2. Blue", "3. Green", OTHER],
  });
  expect(result?.text).toBe(
    `User has answered your questions: "Which color?"="Blue". You can now continue with the user's answers.`,
  );
});

test("collects more than one answer, including a typed answer, until the user selects Done", async () => {
  const { result, dialogs } = await ask(
    [{ question: "Which colors?", options, multiSelect: true }],
    [{ value: "3. Green" }, { value: OTHER }, { value: "Mauve" }, { value: DONE }],
  );

  expect(dialogs.map((d) => d.method)).toEqual(["select", "select", "input", "select"]);
  expect(dialogs[1]?.options).toEqual(["1. Red - warm", "2. Blue", OTHER, DONE]);
  expect(result?.text).toContain(`"Which colors?"="Green, Mauve"`);
});

test("stops at the first question that the user dismisses", async () => {
  const { result, dialogs } = await ask(
    [
      { question: "First?", options },
      { question: "Second?", options },
      { question: "Third?", options },
    ],
    [{ value: "1. Red - warm" }, { cancelled: true }],
  );

  expect(dialogs).toHaveLength(2);
  expect(result?.text).toBe(
    `User has answered your questions: "First?"="Red". The user dismissed the remaining questions.`,
  );
});
