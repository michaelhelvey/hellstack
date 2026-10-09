import { lexer, type Token, type Tokens } from "marked";

/** The part of a transcript message that this mod reads. */
export interface Message {
  role: "user" | "assistant";
  text: string;
  toolResults?: readonly unknown[];
}

/** The part of a `prompt.autocomplete` event that this mod reads. */
export interface Draft {
  text: string;
  token: string;
  start: number;
}

/** The longest label that a typeahead row shows. */
const labelLength = 80;

/** Token types that hold no text to quote. */
const emptyTokens = new Set(["space", "hr", "def"]);

/** Returns true when the token is a list. The `Token` union does not narrow on `type` alone. */
function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}

/** Returns the quotable parts of one top-level Markdown token. */
function tokenParagraphs(token: Token): string[] {
  if (emptyTokens.has(token.type)) return [];
  if (isList(token)) return token.items.map((item) => item.raw.trimEnd());
  const raw = token.raw.replace(/^\n+/, "").trimEnd();
  return raw.trim() ? [raw] : [];
}

/**
 * Splits Markdown text into paragraphs to quote. Each list item is one paragraph. A code block or a
 * table stays as one paragraph.
 */
export function paragraphs(text: string): string[] {
  return lexer(text.replace(/\r\n?/g, "\n")).flatMap(tokenParagraphs);
}

/** Returns true when the message has text. */
function hasText(message: Message): boolean {
  return message.text.trim() !== "";
}

/** Returns true when the message is a prompt from the person, not a tool result. */
function isPrompt(message: Message): boolean {
  return message.role === "user" && !message.toolResults?.length && hasText(message);
}

/** Returns true when the message is a reply with text. */
function isReply(message: Message): boolean {
  return message.role === "assistant" && hasText(message);
}

/** Splits the transcript into the assistant texts that answer each prompt. */
function replyGroups(messages: readonly Message[]): string[][] {
  let group: string[] = [];
  const groups = [group];
  for (const message of messages) {
    if (isPrompt(message)) groups.push((group = []));
    else if (isReply(message)) group.push(message.text);
  }
  return groups.filter((texts) => texts.length > 0);
}

/**
 * Returns the paragraphs of the latest replies to one prompt, in transcript order. When the last
 * prompt has no reply yet, it returns the paragraphs of the replies before it.
 */
export function latestParagraphs(messages: readonly Message[]): string[] {
  return (replyGroups(messages).at(-1) ?? []).flatMap(paragraphs);
}

/** Returns true when a fence line with this marker and text closes the open fence. */
function closesFence(fence: string, marker: string, rest: string): boolean {
  return marker.startsWith(fence) && rest.trim() === "";
}

/** Returns the marker and the text after it when the line is a fence line. */
function fenceLine(line: string): { marker: string; rest: string } | undefined {
  const match = /^ {0,3}(?<marker>`{3,}|~{3,})(?<rest>.*)$/.exec(line);
  return match?.groups as { marker: string; rest: string } | undefined;
}

/** Returns the open fence marker after one more line, or undefined when no fence is open. */
function nextFence(fence: string | undefined, line: string): string | undefined {
  const found = fenceLine(line);
  if (found === undefined) return fence;
  const { marker, rest } = found;
  if (fence === undefined) return marker;
  return closesFence(fence, marker, rest) ? undefined : fence;
}

/** Returns true when the text ends inside an open code fence. */
function isInFence(text: string): boolean {
  return text.split("\n").reduce<string | undefined>(nextFence, undefined) !== undefined;
}

/** Returns true when the token is at the start of a line. */
function startsLine(draft: Draft): boolean {
  const before = draft.text.slice(0, draft.start);
  return before === "" || before.endsWith("\n");
}

/** Returns true when the token is one `>` at the start of a line, outside a code fence and shell mode. */
function asksForQuote(draft: Draft): boolean {
  return (
    startsLine(draft) &&
    /^>(?!>)/.test(draft.token) &&
    !draft.text.startsWith("!") &&
    !isInFence(draft.text.slice(0, draft.start))
  );
}

/** Returns the search text of a quote draft, or undefined when the draft does not ask for a quote. */
export function quoteQuery(draft: Draft): string | undefined {
  return asksForQuote(draft) ? draft.token.slice(1) : undefined;
}

/** Removes accents, so that "spočítaj" agrees with a search for "spocitaj". */
function foldAccents(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase();
}

/**
 * Returns the paragraphs that hold all the words of the query. Words are split on spaces and on
 * `+`, because a token cannot hold a space.
 */
export function filterParagraphs(items: readonly string[], query: string): string[] {
  const words = foldAccents(query)
    .split(/[\s+]+/)
    .filter(Boolean);
  return items.filter((item) => words.every((word) => foldAccents(item).includes(word)));
}

/** Makes a Markdown blockquote of the text. */
export function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** Makes the one-line label of a typeahead row for a paragraph. */
export function label(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > labelLength ? `${line.slice(0, labelLength - 1)}…` : line;
}
