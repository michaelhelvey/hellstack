import type { Theme, ThemeBg, ThemeStyle } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import { type Quote, type QuoteKind, searchWords } from "./quotes.ts";

/** The data that `renderPicker` draws. */
export interface PickerView {
  /** The quotes that match the search. */
  matches: readonly Quote[];
  /** The index of the selected match. */
  selected: number;
  /** The index of the first visible match. */
  offset: number;
  query: string;
}

interface Segment {
  text: string;
  match: boolean;
}

interface Span {
  text: string;
  code: boolean;
}

interface RowStyle {
  theme: Theme;
  words: readonly string[];
  width: number;
}

/** The maximum number of quotes that the picker shows at one time. */
export const MAX_ROWS = 8;

/** The picker is not shown in a narrower editor. */
export const MIN_WIDTH = 24;

const ICONS: Record<QuoteKind, string> = {
  paragraph: "¶",
  list: "•",
  code: "λ",
  heading: "#",
  quote: "»",
  table: "⊞",
};

const HINTS: ReadonlyArray<[string, string]> = [
  ["↑↓ ^n ^p", "move"],
  ["⏎", "quote"],
  ["esc", "close"],
];

const PREVIEW_CLEANUP: Partial<Record<QuoteKind, (text: string) => string>> = {
  list: (text) => text.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ""),
  heading: (text) => text.replace(/^#+\s*/, ""),
  quote: (text) => text.replace(/^>\s?/gm, ""),
  code: (text) => text.replace(/^ {0,3}(?:`{3,}|~{3,}).*$/gm, ""),
};

const INLINE_CLEANUP: ReadonlyArray<[RegExp, string]> = [
  [/!?\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2"],
  [/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1$2"],
];

/**
 * Makes the one-line text that the picker shows for a quote. It removes Markdown markers, but
 * keeps the backticks of inline code.
 */
export function preview(quote: Quote): string {
  const cleanup = PREVIEW_CLEANUP[quote.kind] ?? ((text: string) => text);
  const text = cleanup(quote.text).replace(/\s+/g, " ").trim();
  if (quote.kind === "code") return text;

  return INLINE_CLEANUP.reduce((result, [pattern, value]) => result.replace(pattern, value), text);
}

/** Splits the text into inline code and other text, and removes the backticks. */
export function spans(text: string): Span[] {
  return text
    .split(/`([^`]+)`/)
    .map((part, index) => ({ text: part, code: index % 2 === 1 }))
    .filter((span) => span.text !== "");
}

function fit(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text + " ".repeat(width - visibleWidth(text));

  return `${sliceByColumn(text, 0, width - 1, true)}…`;
}

function fitSpans(parts: readonly Span[], width: number): Span[] {
  let left = width;
  const shown: Span[] = [];
  for (const span of parts) {
    if (left <= 0) break;
    const text = visibleWidth(span.text) > left ? fit(span.text, left) : span.text;
    shown.push({ ...span, text });
    left -= visibleWidth(text);
  }

  return [...shown, { text: " ".repeat(Math.max(0, left)), code: false }];
}

function markWord(lower: string, word: string, mask: boolean[]): void {
  for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) {
    mask.fill(true, at, at + word.length);
  }
}

/** Splits the text into parts that match a search word and parts that do not. */
export function segments(text: string, words: readonly string[]): Segment[] {
  const lower = text.toLocaleLowerCase();
  const mask = new Array<boolean>(text.length).fill(false);
  for (const word of words) markWord(lower, word, mask);

  return mask.reduce<Segment[]>((parts, match, index) => {
    const last = parts.at(-1);
    if (last?.match === match) last.text += text[index];
    else parts.push({ text: text[index] ?? "", match });
    return parts;
  }, []);
}

function paint(theme: Theme, text: string, style: ThemeStyle, bg: ThemeBg | undefined): string {
  return theme.style(text, bg === undefined ? style : { ...style, bg });
}

function spanText(span: Span, bg: ThemeBg | undefined, style: RowStyle): string {
  const plain = bg === undefined ? "muted" : "text";
  const base: ThemeStyle = { fg: span.code ? "mdCode" : plain };
  const match: ThemeStyle = { fg: "accent", bold: true, underline: true };

  return segments(span.text, style.words)
    .map((part) => paint(style.theme, part.text, part.match ? match : base, bg))
    .join("");
}

function quoteText(quote: Quote, bg: ThemeBg | undefined, style: RowStyle): string {
  const text = preview(quote);
  const parts = quote.kind === "code" ? [{ text, code: true }] : spans(text);
  const shown = fitSpans(parts, style.width);

  return shown.map((span) => spanText(span, bg, style)).join("");
}

function quoteRow(quote: Quote, selected: boolean, style: RowStyle): string {
  const { theme } = style;
  const bg = selected ? "selectedBg" : undefined;
  const bar = paint(theme, selected ? "▌ " : "  ", { fg: "accent" }, bg);
  const icon = paint(theme, `${ICONS[quote.kind]} `, { fg: selected ? "accent" : "dim" }, bg);
  const text = quoteText(quote, bg, { ...style, width: style.width - 5 });

  return bar + icon + text + paint(theme, " ", {}, bg);
}

function emptyRow(style: RowStyle): string {
  const text = fit("  no paragraphs match", style.width);

  return style.theme.style(text, { fg: "dim", italic: true });
}

function rows(view: PickerView, style: RowStyle): string[] {
  if (view.matches.length === 0) return [emptyRow(style)];

  return view.matches
    .slice(view.offset, view.offset + MAX_ROWS)
    .map((quote, index) => quoteRow(quote, view.offset + index === view.selected, style));
}

function topBorder(view: PickerView, theme: Theme, width: number): string {
  const title = ` ${theme.style("❝ quote", { fg: "accent", bold: true })} `;
  const position = view.matches.length === 0 ? 0 : view.selected + 1;
  const count = ` ${theme.fg("muted", `${position}/${view.matches.length}`)} `;
  const fill = Math.max(0, width - visibleWidth(title) - visibleWidth(count) - 4);

  return (
    theme.fg("borderMuted", "╭─") +
    title +
    theme.fg("borderMuted", "─".repeat(fill)) +
    count +
    theme.fg("borderMuted", "─╮")
  );
}

function hints(theme: Theme, width: number): string {
  const parts = HINTS.map(([keys, label]) => `${theme.fg("text", keys)} ${theme.fg("dim", label)}`);
  const text = ` ${parts.join(theme.fg("dim", " · "))} `;

  return visibleWidth(text) <= width ? text : "";
}

function bottomBorder(theme: Theme, width: number): string {
  const text = hints(theme, width - 4);
  const fill = Math.max(0, width - visibleWidth(text) - 3);

  return theme.fg("borderMuted", "╰─") + text + theme.fg("borderMuted", `${"─".repeat(fill)}╯`);
}

/**
 * Draws the quote picker as a box with rounded corners. It shows at most `MAX_ROWS` quotes, and
 * marks the parts of each quote that match the search.
 */
export function renderPicker(view: PickerView, theme: Theme, width: number): string[] {
  if (width < MIN_WIDTH) return [];
  const side = theme.fg("borderMuted", "│");
  const style = { theme, words: searchWords(view.query), width: width - 2 };

  return [
    topBorder(view, theme, width),
    ...rows(view, style).map((row) => side + row + side),
    bottomBorder(theme, width),
  ];
}
