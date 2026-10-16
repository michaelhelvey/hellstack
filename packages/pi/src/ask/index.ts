import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const OTHER = "Other (type an answer)";
const DONE = "Done";

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The complete question to ask the user" }),
  header: Type.Optional(Type.String({ description: "Very short label for the question" })),
  options: Type.Array(
    Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) }),
    { minItems: 2, maxItems: 4 },
  ),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow more than one answer" })),
});

type Question = Static<typeof QuestionSchema>;

/** One question and the answer of the user. */
export interface Answer {
  question: string;
  answer: string;
}

interface Dialog {
  ui: ExtensionContext["ui"];
  title: string;
  /** The text of each choice in the dialog, mapped to the label of its option. */
  labels: Map<string, string>;
  options: { signal?: AbortSignal };
}

function dialogFor(ui: Dialog["ui"], question: Question, signal: AbortSignal | undefined): Dialog {
  const title = question.header ? `${question.header}: ${question.question}` : question.question;
  const labels = question.options.map((option, index): [string, string] => {
    const description = option.description ? ` - ${option.description}` : "";
    return [`${index + 1}. ${option.label}${description}`, option.label];
  });
  return { ui, title, labels: new Map(labels), options: signal ? { signal } : {} };
}

async function resolvePick(dialog: Dialog, pick: string): Promise<string | undefined> {
  if (pick !== OTHER) return dialog.labels.get(pick);
  return dialog.ui.input(dialog.title, "Your answer", dialog.options);
}

async function pickOne(dialog: Dialog): Promise<string | undefined> {
  const choices = [...dialog.labels.keys(), OTHER];
  const pick = await dialog.ui.select(dialog.title, choices, dialog.options);
  return pick === undefined ? undefined : resolvePick(dialog, pick);
}

async function pickMany(dialog: Dialog, answers: string[]): Promise<string[] | undefined> {
  const remaining = [...dialog.labels].filter(([, label]) => !answers.includes(label));
  const choices = [...remaining.map(([text]) => text), OTHER, DONE];
  const title = `${dialog.title} (one at a time, then ${DONE})`;
  const pick = await dialog.ui.select(title, choices, dialog.options);
  if (pick === DONE) return answers;
  const text = pick === undefined ? undefined : await resolvePick(dialog, pick);
  return text === undefined ? undefined : pickMany(dialog, [...answers, text]);
}

async function askOne(dialog: Dialog, multiSelect: boolean): Promise<string | undefined> {
  if (!multiSelect) return pickOne(dialog);
  return (await pickMany(dialog, []))?.join(", ");
}

/** Returns the text that the model gets for the answers to the questions that it asked. */
export function resultText(asked: number, answers: Answer[]): string {
  const pairs = answers.map((a) => `"${a.question}"="${a.answer}"`).join(", ");
  const answered = answers.length > 0 ? `User has answered your questions: ${pairs}. ` : "";
  if (answers.length === asked) return `${answered}You can now continue with the user's answers.`;
  if (answers.length > 0) return `${answered}The user dismissed the remaining questions.`;
  return "The user dismissed the question without answering.";
}

/** Adds the `ask_user_question` tool, which asks the user questions with fixed choices. */
export default function ask(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask user",
    exposure: "model-only",
    description:
      "Ask the user 1-4 structured questions, each with 2-4 options; the user can also type their own answer. Use it for genuine preference calls the user must make.",
    parameters: Type.Object({
      questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 4 }),
    }),
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) throw new Error("This session has no UI. Ask the user in plain text.");
      const answers: Answer[] = [];
      for (const question of params.questions) {
        const answer = await askOne(dialogFor(ctx.ui, question, signal), !!question.multiSelect);
        if (answer === undefined) break;
        answers.push({ question: question.question, answer });
      }
      const text = resultText(params.questions.length, answers);
      return { content: [{ type: "text", text }], details: { answers } };
    },
  });
}
