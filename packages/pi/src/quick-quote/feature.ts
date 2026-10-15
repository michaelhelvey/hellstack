import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Keybinding,
  type KeyId,
  matchesKey,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";

import type { EditorFeature, EditorHost } from "../shared/editor/feature.ts";
import { MAX_ROWS, renderPicker } from "./picker.ts";
import { blockquote, filterQuotes, type Quote, type QuoteTrigger, quoteTrigger } from "./quotes.ts";

/** The sources of data for `QuotePicker`. */
export interface QuotePickerOptions {
  /** Gets the quotes from the last assistant replies. */
  quotes: () => readonly Quote[];
  /** Gets the current theme. */
  theme: () => Theme;
}

type PickerAction = "up" | "down" | "insert" | "close";

interface PickerBinding {
  action: PickerAction;
  /** Keys that always do the action, in addition to the key bindings. */
  keys: KeyId[];
  bindings: Keybinding[];
}

interface ActivePicker {
  trigger: QuoteTrigger;
  matches: Quote[];
}

const BINDINGS: readonly PickerBinding[] = [
  { action: "up", keys: ["ctrl+p"], bindings: ["tui.select.up"] },
  { action: "down", keys: ["ctrl+n"], bindings: ["tui.select.down"] },
  { action: "insert", keys: [], bindings: ["tui.select.confirm", "tui.input.tab"] },
  { action: "close", keys: [], bindings: ["tui.select.cancel"] },
];

const CLEAR_LINE = "\x15";

const BACKSPACE = "\x7f";

/**
 * An editor feature with a quote picker. When the cursor is at the end of a line that starts with
 * `>`, the picker shows the blocks of the last assistant replies above the editor. The text after
 * `>` filters the blocks.
 */
export class QuotePicker implements EditorFeature {
  readonly #editor: EditorHost;
  readonly #options: QuotePickerOptions;
  #selected = 0;
  #offset = 0;
  #searchKey: string | undefined;
  #dismissedRow: number | undefined;

  constructor(editor: EditorHost, options: QuotePickerOptions) {
    this.#editor = editor;
    this.#options = options;
  }

  handleInput(data: string): boolean {
    const picker = this.#picker();
    const action = picker && this.#action(data);
    if (!picker || !action) return false;
    this.#run(action, picker);

    return true;
  }

  render(width: number): string[] {
    const picker = this.#picker();

    return picker ? renderPicker(this.#view(picker), this.#options.theme(), width) : [];
  }

  handleMouse(event: TuiMouseEvent): void {
    const picker = this.#picker();
    if (picker && event.type === "click") this.#click(event.y - 1, picker);
  }

  #click(row: number, picker: ActivePicker): void {
    const index = this.#offset + row;
    if (row < 0 || row >= MAX_ROWS || index >= picker.matches.length) return;
    this.#selected = index;
    this.#insert(picker);
  }

  readonly #handlers: Record<PickerAction, (picker: ActivePicker) => void> = {
    up: (picker) => this.#move(-1, picker),
    down: (picker) => this.#move(1, picker),
    insert: (picker) => this.#insert(picker),
    close: (picker) => (this.#dismissedRow = picker.trigger.row),
  };

  #picker(): ActivePicker | undefined {
    const trigger = this.#trigger();
    const quotes = this.#options.quotes();
    if (!trigger || quotes.length === 0) return undefined;

    return this.#sync({ trigger, matches: filterQuotes(quotes, trigger.query) });
  }

  #trigger(): QuoteTrigger | undefined {
    const { line, col } = this.#editor.getCursor();
    const trigger = quoteTrigger(this.#editor.getLines(), line, col);
    if (trigger?.row === this.#dismissedRow) return undefined;
    this.#dismissedRow = undefined;

    return trigger;
  }

  #sync(picker: ActivePicker): ActivePicker {
    const key = `${picker.trigger.row}:${picker.trigger.query}`;
    if (key !== this.#searchKey) [this.#selected, this.#offset] = [0, 0];
    this.#searchKey = key;
    this.#selected = Math.min(this.#selected, Math.max(0, picker.matches.length - 1));

    return picker;
  }

  #view(picker: ActivePicker) {
    const { matches, trigger } = picker;

    return { matches, selected: this.#selected, offset: this.#offset, query: trigger.query };
  }

  #action(data: string): PickerAction | undefined {
    return BINDINGS.find((binding) => this.#matches(data, binding))?.action;
  }

  #matches(data: string, binding: PickerBinding): boolean {
    const keys = binding.keys.some((key) => matchesKey(data, key));

    return keys || binding.bindings.some((name) => this.#editor.keys.matches(data, name));
  }

  #run(action: PickerAction, picker: ActivePicker): void {
    this.#handlers[action](picker);
    this.#editor.requestRender();
  }

  #move(delta: number, picker: ActivePicker): void {
    const count = picker.matches.length;
    if (count === 0) return;
    this.#selected = (this.#selected + delta + count) % count;
    const lowest = this.#selected - MAX_ROWS + 1;
    this.#offset = Math.min(Math.max(this.#offset, lowest), this.#selected);
  }

  #insert(picker: ActivePicker): void {
    const quote = picker.matches[this.#selected];
    if (quote === undefined) return;
    this.#clearLine();
    this.#editor.insertTextAtCursor(`${blockquote(quote.text)}\n\n`);
  }

  #clearLine(): void {
    if (this.#editor.keys.matches(CLEAR_LINE, "tui.editor.deleteToLineStart")) {
      this.#editor.input(CLEAR_LINE);
      return;
    }
    for (let col = this.#editor.getCursor().col; col > 0;) {
      this.#editor.input(BACKSPACE);
      const next = this.#editor.getCursor().col;
      col = next < col ? next : 0;
    }
  }
}
