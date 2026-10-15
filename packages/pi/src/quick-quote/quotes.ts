import { lexer, type Token } from "marked";
import { z } from "zod";

/** The type of Markdown block that a quote comes from. */
export type QuoteKind = "paragraph" | "list" | "code" | "heading" | "quote" | "table";

/** One block of an assistant reply that the user can quote. */
export interface Quote {
  kind: QuoteKind;
  /** The Markdown source of the block. */
  text: string;
}

/** The `>` line at the cursor that opens the picker. */
export interface QuoteTrigger {
  /** The index of the line in the editor. */
  row: number;
  /** The search words after `>`. */
  query: string;
}

const SKIPPED_TOKENS = new Set(["space", "hr", "def"]);

const KINDS: Partial<Record<string, QuoteKind>> = {
  code: "code",
  heading: "heading",
  blockquote: "quote",
  table: "table",
};

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const ListToken = z.object({
  type: z.literal("list"),
  items: z.array(z.object({ raw: z.string() })),
});

const TextPart = z.object({ type: z.literal("text"), text: z.string() });

const MessageEntry = z.object({
  type: z.literal("message"),
  message: z.object({ role: z.string(), content: z.union([z.string(), z.array(z.unknown())]) }),
});

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

function blockQuote(token: Token): Quote[] {
  const text = token.raw.replace(/^\n+/, "").trimEnd();
  const kind = KINDS[token.type] ?? "paragraph";

  return text.trim() ? [{ kind, text }] : [];
}

function tokenQuotes(token: Token): Quote[] {
  if (SKIPPED_TOKENS.has(token.type)) return [];
  const list = ListToken.safeParse(token);
  if (!list.success) return blockQuote(token);

  return list.data.items.map((item) => ({ kind: "list", text: item.raw.trimEnd() }));
}

/**
 * Splits Markdown into blocks that the user can quote. Each list item is a block. Code blocks and
 * tables stay together.
 */
export function paragraphs(markdown: string): Quote[] {
  return lexer(markdown.replace(/\r\n?/g, "\n")).flatMap(tokenQuotes);
}

function closesFence(open: string, marker: string, rest: string): boolean {
  return marker[0] === open[0] && marker.length >= open.length && !rest.trim();
}

function nextFence(open: string | undefined, marker: string, rest: string): string | undefined {
  if (open === undefined) return marker;

  return closesFence(open, marker, rest) ? undefined : open;
}

function fenceAfter(open: string | undefined, line: string): string | undefined {
  const match = FENCE.exec(line);
  if (!match) return open;
  const [, marker = "", rest = ""] = match;

  return nextFence(open, marker, rest);
}

function insideFence(lines: readonly string[]): boolean {
  return lines.reduce<string | undefined>(fenceAfter, undefined) !== undefined;
}

function opensPicker(line: string, col: number): boolean {
  return col === line.length && /^>(?!>)/.test(line);
}

/**
 * Finds the `>` line that opens the picker. The cursor must be at the end of a line that starts
 * with one `>`, outside a fenced code block. The search can contain spaces.
 */
export function quoteTrigger(
  lines: readonly string[],
  row: number,
  col: number,
): QuoteTrigger | undefined {
  const [line = ""] = lines.slice(row, row + 1);
  if (!opensPicker(line, col) || insideFence(lines.slice(0, row))) return undefined;

  return { row, query: line.slice(1).trim() };
}

/** Removes accents, so that a search for "spocitaj" finds "spočítaj". */
export function foldAccents(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "");
}

/** Splits a search into lowercase words without accents. */
export function searchWords(query: string): string[] {
  return foldAccents(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Keeps the quotes that contain all words of the search, in any order. */
export function filterQuotes(quotes: readonly Quote[], query: string): Quote[] {
  const words = searchWords(query);

  return quotes.filter((quote) => {
    const text = foldAccents(quote.text).toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Makes a Markdown blockquote from the text. */
export function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function textOf(content: string | unknown[]): string {
  if (typeof content === "string") return content;

  return content.flatMap((part) => TextPart.safeParse(part).data?.text ?? []).join("\n\n");
}

function toChatMessage(role: string, text: string): ChatMessage[] {
  if (role === "user") return [{ role, text }];

  return role === "assistant" && text.trim() ? [{ role, text }] : [];
}

function chatMessage(entry: unknown): ChatMessage[] {
  const parsed = MessageEntry.safeParse(entry);
  if (!parsed.success) return [];
  const { role, content } = parsed.data.message;

  return toChatMessage(role, textOf(content));
}

/**
 * Gets the text of the last group of assistant replies on the session branch: the replies after
 * the last user message that has a reply. While a new user message waits for a reply, the
 * previous group stays available.
 */
export function lastReplies(entries: readonly unknown[]): string[] {
  const messages = entries.flatMap(chatMessage);
  const last = messages.findLastIndex((message) => message.role === "assistant");
  if (last < 0) return [];
  const user = messages.slice(0, last).findLastIndex((message) => message.role === "user");

  return messages
    .slice(user + 1, last + 1)
    .flatMap((message) => (message.role === "assistant" ? [message.text] : []));
}
