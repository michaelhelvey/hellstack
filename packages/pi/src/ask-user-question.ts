import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

/** The choice that lets the user type an answer. */
export const OTHER = "Other (type an answer)";

/** The choice that ends a question that allows more than one answer. */
export const DONE = "Done";

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The complete question to ask the user" }),
  header: Type.Optional(Type.String({ description: "Very short label for the question" })),
  options: Type.Array(
    Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) }),
    { minItems: 2, maxItems: 4 },
  ),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow more than one answer" })),
});

const AskParams = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 4 }),
});

type Question = Static<typeof QuestionSchema>;

interface Answer {
  readonly question: string;
  readonly answer: string;
}

interface Dialog {
  readonly ui: ExtensionContext["ui"];
  readonly title: string;
  /** The text of each choice in the dialog, mapped to the label of its option. */
  readonly labels: Map<string, string>;
  readonly options: { signal?: AbortSignal };
}

const dialogFor = (ui: Dialog["ui"], question: Question, signal?: AbortSignal): Dialog => ({
  ui,
  title: question.header ? `${question.header}: ${question.question}` : question.question,
  labels: new Map(
    question.options.map((option, index) => [
      `${index + 1}. ${option.label}${option.description ? ` - ${option.description}` : ""}`,
      option.label,
    ]),
  ),
  options: signal ? { signal } : {},
});

const resolvePick = async (dialog: Dialog, pick: string) =>
  pick === OTHER
    ? dialog.ui.input(dialog.title, "Your answer", dialog.options)
    : dialog.labels.get(pick);

const pickOne = async (dialog: Dialog) => {
  const pick = await dialog.ui.select(
    dialog.title,
    [...dialog.labels.keys(), OTHER],
    dialog.options,
  );
  return pick === undefined ? undefined : resolvePick(dialog, pick);
};

const pickMany = async (
  dialog: Dialog,
  answers: Array<string>,
): Promise<Array<string> | undefined> => {
  const remaining = [...dialog.labels].filter(([, label]) => !answers.includes(label));
  const choices = [...remaining.map(([text]) => text), OTHER, DONE];
  const pick = await dialog.ui.select(
    `${dialog.title} (one at a time, then ${DONE})`,
    choices,
    dialog.options,
  );
  if (pick === DONE) return answers;
  const text = pick === undefined ? undefined : await resolvePick(dialog, pick);
  return text === undefined ? undefined : pickMany(dialog, [...answers, text]);
};

const askOne = async (dialog: Dialog, multiSelect: boolean) =>
  multiSelect ? (await pickMany(dialog, []))?.join(", ") : pickOne(dialog);

const askAll = async (
  ui: Dialog["ui"],
  questions: ReadonlyArray<Question>,
  signal?: AbortSignal,
): Promise<Array<Answer>> => {
  const [question, ...rest] = questions;
  if (question === undefined) return [];
  const answer = await askOne(dialogFor(ui, question, signal), !!question.multiSelect);
  if (answer === undefined) return [];
  return [{ question: question.question, answer }, ...(await askAll(ui, rest, signal))];
};

const resultText = (asked: number, answers: ReadonlyArray<Answer>) => {
  const pairs = answers.map((a) => `"${a.question}"="${a.answer}"`).join(", ");
  const answered = answers.length > 0 ? `User has answered your questions: ${pairs}. ` : "";
  if (answers.length === asked) return `${answered}You can now continue with the user's answers.`;
  if (answers.length > 0) return `${answered}The user dismissed the remaining questions.`;
  return "The user dismissed the question without answering.";
};

/**
 * Adds the `ask_user_question` tool. The tool asks the user 1-4 questions in dialogs. For each
 * question, the user selects one option, more than one option, or types an answer.
 */
export default function askUserQuestion(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask user",
    exposure: "model-only",
    description:
      "Ask the user 1-4 structured questions, each with 2-4 options; the user can also type their own answer. Use it for genuine preference calls the user must make.",
    parameters: AskParams,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) throw new Error("This session has no UI. Ask the user in plain text.");
      const answers = await askAll(ctx.ui, params.questions, signal);
      const text = resultText(params.questions.length, answers);
      return { content: [{ type: "text", text }], details: { answers } };
    },
  });
}
