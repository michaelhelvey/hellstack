import type { CommandRunner, FeedRecord } from "../core/index.ts";
import { oneLine } from "./source.ts";

/** The time that the summary model has to answer, in milliseconds. */
export const SUMMARY_TIMEOUT_MS = 20_000;

/** A feed record without its summary. */
export type FeedFacts = Omit<FeedRecord, "summary">;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function routedText(facts: FeedFacts): string {
  const targets = [...new Set(facts.routed.map((route) => route.to))].join(", ");
  return facts.routed.length > 0 ? `, routed ${facts.routed.length} to ${targets}` : "";
}

/** Returns the fixed summary sentence of a poll cycle. */
export function templateSummary(facts: FeedFacts): string {
  if (!facts.ok) return `The ${facts.source} poll failed: ${facts.error ?? "unknown error"}.`;
  if (facts.new === 0) return `No new ${facts.source} events.`;
  const routed = routedText(facts);
  return `${plural(facts.new, `new ${facts.source} event`)}${routed}, ${facts.ignored} ignored.`;
}

/** Returns the `pi` arguments that ask `model` for the summary of a poll cycle. */
export function summaryArgs(model: string, facts: FeedFacts, titles: string[]): string[] {
  const prompt = [
    "Write one short plain sentence for a status feed about this poll of an event source.",
    "Tell what came in and where it went. Do not use Markdown. Do not add other text.",
    JSON.stringify({ ...facts, titles }),
  ].join("\n");
  const flags = [
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
  ];
  return ["-p", ...flags, "--no-prompt-templates", "--model", model, prompt];
}

/**
 * Returns the summary of a poll cycle. It asks the summary model only when the cycle has new events
 * or an error. When the model fails or does not answer in time, it returns the template sentence.
 */
export async function summarize(
  facts: FeedFacts,
  titles: string[],
  options: { model: string; runner: CommandRunner },
): Promise<string> {
  const template = templateSummary(facts);
  if (facts.ok && facts.new === 0) return template;
  const text = await askModel(options.runner, summaryArgs(options.model, facts, titles));
  return text || template;
}

async function askModel(runner: CommandRunner, args: string[]): Promise<string> {
  const result = await runner("pi", args, SUMMARY_TIMEOUT_MS).catch(() => undefined);
  return result?.code === 0 ? oneLine(result.stdout, 300) : "";
}
