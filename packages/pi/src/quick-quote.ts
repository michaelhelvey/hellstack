import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
  type ThemeBg,
  type ThemeStyle,
} from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  type Keybinding,
  type KeyId,
  matchesKey,
  sliceByColumn,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { lexer, type Token } from "marked";
import { z } from "zod";

type QuoteKind = "paragraph" | "list" | "code" | "heading" | "quote" | "table";

/** One block of an assistant reply that the user can quote. */
interface Quote {
  readonly kind: QuoteKind;
  /** The Markdown source of the block. */
  readonly text: string;
}

/** The `>` line at the cursor that opens the picker. */
interface Trigger {
  /** The index of the line in the editor. */
  readonly row: number;
  /** The search words after `>`. */
  readonly query: string;
}

/** The state of an open picker. */
interface Picker {
  readonly trigger: Trigger;
  readonly matches: ReadonlyArray<Quote>;
}

interface Span {
  readonly text: string;
  readonly code: boolean;
}

interface RowStyle {
  readonly theme: Theme;
  readonly words: ReadonlyArray<string>;
  readonly width: number;
}

type Action = "up" | "down" | "insert" | "close";

/** The maximum number of quotes that the picker shows at one time. */
const MAX_ROWS = 8;

/** The picker is not shown in a narrower editor. */
const MIN_WIDTH = 24;

const CLEAR_LINE = "\x15";
const BACKSPACE = "\x7f";

const BINDINGS: ReadonlyArray<{
  action: Action;
  /** Keys that always do the action, in addition to the key bindings. */
  keys: ReadonlyArray<KeyId>;
  bindings: ReadonlyArray<Keybinding>;
}> = [
  { action: "up", keys: ["ctrl+p"], bindings: ["tui.select.up"] },
  { action: "down", keys: ["ctrl+n"], bindings: ["tui.select.down"] },
  { action: "insert", keys: [], bindings: ["tui.select.confirm", "tui.input.tab"] },
  { action: "close", keys: [], bindings: ["tui.select.cancel"] },
];

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

const KINDS: Partial<Record<string, QuoteKind>> = {
  code: "code",
  heading: "heading",
  blockquote: "quote",
  table: "table",
};

const SKIPPED_TOKENS = new Set(["space", "hr", "def"]);

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

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

const ListToken = z.object({
  type: z.literal("list"),
  items: z.array(z.object({ raw: z.string() })),
});

const TextPart = z.object({ type: z.literal("text"), text: z.string() });

const MessageEntry = z.object({
  type: z.literal("message"),
  message: z.object({ role: z.string(), content: z.union([z.string(), z.array(z.unknown())]) }),
});

const blockQuote = (token: Token): Array<Quote> => {
  const text = token.raw.replace(/^\n+/, "").trimEnd();
  return text.trim() ? [{ kind: KINDS[token.type] ?? "paragraph", text }] : [];
};

const tokenQuotes = (token: Token): Array<Quote> => {
  if (SKIPPED_TOKENS.has(token.type)) return [];
  const list = ListToken.safeParse(token);
  if (!list.success) return blockQuote(token);
  return list.data.items.map((item) => ({ kind: "list", text: item.raw.trimEnd() }));
};

/** Splits Markdown into blocks. Each list item is a block. Code blocks and tables stay together. */
const paragraphs = (markdown: string) =>
  lexer(markdown.replace(/\r\n?/g, "\n")).flatMap(tokenQuotes);

const blockquote = (text: string) =>
  text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

type ChatMessage = { readonly role: "user" | "assistant"; readonly text: string };

const textOf = (content: string | Array<unknown>) =>
  typeof content === "string"
    ? content
    : content.flatMap((part) => TextPart.safeParse(part).data?.text ?? []).join("\n\n");

const toChatMessage = (role: string, text: string): Array<ChatMessage> => {
  if (role === "user") return [{ role, text }];
  return role === "assistant" && text.trim() ? [{ role, text }] : [];
};

const chatMessage = (entry: unknown): Array<ChatMessage> => {
  const parsed = MessageEntry.safeParse(entry);
  if (!parsed.success) return [];
  return toChatMessage(parsed.data.message.role, textOf(parsed.data.message.content));
};

/**
 * Gets the text of the last group of assistant replies: the replies after the last user message
 * that has a reply. While a new user message waits for a reply, the previous group stays.
 */
const lastReplies = (entries: ReadonlyArray<unknown>) => {
  const messages = entries.flatMap(chatMessage);
  const last = messages.findLastIndex((message) => message.role === "assistant");
  if (last < 0) return [];
  const user = messages.slice(0, last).findLastIndex((message) => message.role === "user");
  return messages
    .slice(user + 1, last + 1)
    .flatMap((message) => (message.role === "assistant" ? [message.text] : []));
};

const quoteSource = (session: ExtensionContext["sessionManager"]) => {
  let leaf: string | null | undefined;
  let quotes: Array<Quote> = [];
  return () => {
    const current = session.getLeafId();
    if (current === leaf) return quotes;
    leaf = current;
    quotes = lastReplies(session.getBranch()).flatMap(paragraphs);
    return quotes;
  };
};

const closesFence = (open: string, marker: string, rest: string) =>
  marker[0] === open[0] && marker.length >= open.length && !rest.trim();

const nextFence = (open: string | undefined, marker: string, rest: string) => {
  if (open === undefined) return marker;
  return closesFence(open, marker, rest) ? undefined : open;
};

const fenceAfter = (open: string | undefined, line: string) => {
  const match = FENCE.exec(line);
  return match ? nextFence(open, match[1] ?? "", match[2] ?? "") : open;
};

const insideFence = (lines: ReadonlyArray<string>) =>
  lines.reduce<string | undefined>(fenceAfter, undefined) !== undefined;

/**
 * Finds the `>` line that opens the picker. The cursor must be at the end of a line that starts
 * with one `>`, outside a fenced code block.
 */
const opensPicker = (line: string, col: number) => col === line.length && /^>(?!>)/.test(line);

const findTrigger = (lines: ReadonlyArray<string>, row: number, col: number) => {
  const [line = ""] = lines.slice(row, row + 1);
  if (!opensPicker(line, col) || insideFence(lines.slice(0, row))) return undefined;
  return { row, query: line.slice(1).trim() };
};

/** Removes accents, so that a search for "spocitaj" finds "spočítaj". */
const foldAccents = (text: string) => text.normalize("NFKD").replace(/\p{M}+/gu, "");

const searchWords = (query: string) =>
  foldAccents(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);

const filterQuotes = (quotes: ReadonlyArray<Quote>, query: string) => {
  const words = searchWords(query);
  return quotes.filter((quote) => {
    const text = foldAccents(quote.text).toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
};

const preview = (quote: Quote) => {
  const cleanup = PREVIEW_CLEANUP[quote.kind] ?? ((text: string) => text);
  const text = cleanup(quote.text).replace(/\s+/g, " ").trim();
  if (quote.kind === "code") return text;
  return INLINE_CLEANUP.reduce((result, [pattern, value]) => result.replace(pattern, value), text);
};

const spans = (text: string): Array<Span> =>
  text
    .split(/`([^`]+)`/)
    .map((part, index) => ({ text: part, code: index % 2 === 1 }))
    .filter((span) => span.text !== "");

const fit = (text: string, width: number) =>
  visibleWidth(text) <= width
    ? text + " ".repeat(width - visibleWidth(text))
    : `${sliceByColumn(text, 0, width - 1, true)}…`;

const fitSpans = (parts: ReadonlyArray<Span>, width: number) => {
  const shown = parts.reduce<{ spans: Array<Span>; left: number }>(
    (acc, span) => {
      if (acc.left <= 0) return acc;
      const text = visibleWidth(span.text) > acc.left ? fit(span.text, acc.left) : span.text;
      return { spans: [...acc.spans, { ...span, text }], left: acc.left - visibleWidth(text) };
    },
    { spans: [], left: width },
  );
  return [...shown.spans, { text: " ".repeat(Math.max(0, shown.left)), code: false }];
};

/** Splits the text into parts that match a search word and parts that do not. */
const segments = (text: string, words: ReadonlyArray<string>) => {
  const lower = text.toLocaleLowerCase();
  const mask = Array.from({ length: text.length }, () => false);
  for (const word of words) {
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) {
      mask.fill(true, at, at + word.length);
    }
  }
  return mask.reduce<Array<{ text: string; match: boolean }>>((parts, match, index) => {
    const last = parts.at(-1);
    if (last?.match === match) last.text += text[index];
    else parts.push({ text: text[index] ?? "", match });
    return parts;
  }, []);
};

const paint = (theme: Theme, text: string, style: ThemeStyle, bg: ThemeBg | undefined) =>
  theme.style(text, bg === undefined ? style : { ...style, bg });

const spanText = (span: Span, bg: ThemeBg | undefined, style: RowStyle) => {
  const base: ThemeStyle = { fg: span.code ? "mdCode" : bg === undefined ? "muted" : "text" };
  const match: ThemeStyle = { fg: "accent", bold: true, underline: true };
  return segments(span.text, style.words)
    .map((part) => paint(style.theme, part.text, part.match ? match : base, bg))
    .join("");
};

const quoteSpans = (quote: Quote) => {
  const text = preview(quote);
  return quote.kind === "code" ? [{ text, code: true }] : spans(text);
};

const quoteRow = (quote: Quote, selected: boolean, style: RowStyle) => {
  const { theme } = style;
  const bg = selected ? "selectedBg" : undefined;
  const parts = fitSpans(quoteSpans(quote), style.width - 5);
  return (
    paint(theme, selected ? "▌ " : "  ", { fg: "accent" }, bg) +
    paint(theme, `${ICONS[quote.kind]} `, { fg: selected ? "accent" : "dim" }, bg) +
    parts.map((span) => spanText(span, bg, style)).join("") +
    paint(theme, " ", {}, bg)
  );
};

const rows = (picker: Picker, selected: number, offset: number, style: RowStyle) =>
  picker.matches.length === 0
    ? [style.theme.style(fit("  no paragraphs match", style.width), { fg: "dim", italic: true })]
    : picker.matches
        .slice(offset, offset + MAX_ROWS)
        .map((quote, index) => quoteRow(quote, offset + index === selected, style));

const topBorder = (picker: Picker, selected: number, theme: Theme, width: number) => {
  const title = ` ${theme.style("❝ quote", { fg: "accent", bold: true })} `;
  const position = picker.matches.length === 0 ? 0 : selected + 1;
  const count = ` ${theme.fg("muted", `${position}/${picker.matches.length}`)} `;
  const fill = Math.max(0, width - visibleWidth(title) - visibleWidth(count) - 4);
  return (
    theme.fg("borderMuted", "╭─") +
    title +
    theme.fg("borderMuted", "─".repeat(fill)) +
    count +
    theme.fg("borderMuted", "─╮")
  );
};

const bottomBorder = (theme: Theme, width: number) => {
  const parts = HINTS.map(([keys, label]) => `${theme.fg("text", keys)} ${theme.fg("dim", label)}`);
  const hints = ` ${parts.join(theme.fg("dim", " · "))} `;
  const text = visibleWidth(hints) <= width - 4 ? hints : "";
  const fill = Math.max(0, width - visibleWidth(text) - 3);
  return theme.fg("borderMuted", "╰─") + text + theme.fg("borderMuted", `${"─".repeat(fill)}╯`);
};

/**
 * The pi editor with a quote picker. When the cursor is at the end of a line that starts with `>`,
 * the picker shows the blocks of the last assistant replies above the editor. The text after `>`
 * filters the blocks.
 */
class QuoteEditor extends CustomEditor {
  #selected = 0;
  #offset = 0;
  #searchKey: string | undefined;
  #dismissedRow: number | undefined;
  #pickerHeight = 0;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    readonly keys: KeybindingsManager,
    private readonly quotes: () => ReadonlyArray<Quote>,
    private readonly uiTheme: () => Theme,
  ) {
    super(tui, theme, keys, { embedWorkingStatus: true });
  }

  override handleInput(data: string): void {
    const picker = this.#picker();
    const action = BINDINGS.find((b) => this.#matches(data, b))?.action;
    if (!picker || !action) return super.handleInput(data);
    this.#actions[action](picker);
    this.tui.requestRender();
  }

  override render(width: number): Array<string> {
    const picker = this.focused ? this.#picker() : undefined;
    const lines = picker && width >= MIN_WIDTH ? this.#renderPicker(picker, width) : [];
    this.#pickerHeight = lines.length;
    return [...lines, ...super.render(width)];
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.y >= this.#pickerHeight) {
      return super.handleMouse({ ...event, y: event.y - this.#pickerHeight });
    }
    const picker = this.#picker();
    if (picker && event.type === "click") this.#click(event.y - 1, picker);
    return { handled: true, focus: true };
  }

  readonly #actions: Record<Action, (picker: Picker) => void> = {
    up: (picker) => this.#move(-1, picker),
    down: (picker) => this.#move(1, picker),
    insert: (picker) => this.#insert(picker),
    close: (picker) => (this.#dismissedRow = picker.trigger.row),
  };

  #matches(data: string, binding: (typeof BINDINGS)[number]) {
    return (
      binding.keys.some((key) => matchesKey(data, key)) ||
      binding.bindings.some((name) => this.keys.matches(data, name))
    );
  }

  #picker(): Picker | undefined {
    const trigger = this.#trigger();
    const quotes = this.quotes();
    if (!trigger || quotes.length === 0) return undefined;
    const picker = { trigger, matches: filterQuotes(quotes, trigger.query) };
    const key = `${trigger.row}:${trigger.query}`;
    if (key !== this.#searchKey) [this.#selected, this.#offset] = [0, 0];
    this.#searchKey = key;
    this.#selected = Math.min(this.#selected, Math.max(0, picker.matches.length - 1));
    return picker;
  }

  #trigger(): Trigger | undefined {
    const { line, col } = this.getCursor();
    const trigger = findTrigger(this.getLines(), line, col);
    if (trigger?.row === this.#dismissedRow) return undefined;
    this.#dismissedRow = undefined;
    return trigger;
  }

  #renderPicker(picker: Picker, width: number) {
    const theme = this.uiTheme();
    const side = theme.fg("borderMuted", "│");
    const style = { theme, words: searchWords(picker.trigger.query), width: width - 2 };
    return [
      topBorder(picker, this.#selected, theme, width),
      ...rows(picker, this.#selected, this.#offset, style).map((row) => side + row + side),
      bottomBorder(theme, width),
    ];
  }

  #click(row: number, picker: Picker): void {
    const index = this.#offset + row;
    if (row < 0 || row >= MAX_ROWS || index >= picker.matches.length) return;
    this.#selected = index;
    this.#insert(picker);
  }

  #move(delta: number, picker: Picker): void {
    const count = picker.matches.length;
    if (count === 0) return;
    this.#selected = (this.#selected + delta + count) % count;
    const lowest = this.#selected - MAX_ROWS + 1;
    this.#offset = Math.min(Math.max(this.#offset, lowest), this.#selected);
  }

  #insert(picker: Picker): void {
    const quote = picker.matches[this.#selected];
    if (quote === undefined) return;
    this.#clearLine();
    this.insertTextAtCursor(`${blockquote(quote.text)}\n\n`);
  }

  #clearLine(): void {
    if (this.keys.matches(CLEAR_LINE, "tui.editor.deleteToLineStart")) {
      return super.handleInput(CLEAR_LINE);
    }
    for (let col = this.getCursor().col; col > 0;) {
      super.handleInput(BACKSPACE);
      const next = this.getCursor().col;
      col = next < col ? next : 0;
    }
  }
}

/**
 * Lets the user quote blocks of the last assistant replies. Type `>` at the start of a line to
 * open the picker, then type words to filter it.
 */
export default function quickQuote(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const quotes = quoteSource(ctx.sessionManager);
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new QuoteEditor(tui, theme, keybindings, quotes, () => ctx.ui.theme),
    );
  });
}
