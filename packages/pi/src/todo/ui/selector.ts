import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Focusable,
  Input,
  Key,
  matchesKey,
  Spacer,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

import { filterTodos, isTodoClosed, type TodoFrontMatter } from "../model.ts";
import { renderSelectorLine } from "../render.ts";
import { accentBorder, addChildren, dispatchKey, type KeybindingMatcher } from "./shared.ts";

const MAX_VISIBLE = 10;

const HINTS =
  "Type to search • ↑↓ select • Enter actions • Ctrl+Shift+W work • Ctrl+Shift+R refine • Esc close";

/** The environment and callbacks of a {@link TodoSelector}. */
export interface TodoSelectorOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingMatcher;
  todos: TodoFrontMatter[];
  initialSearch: string;
  currentSessionId: string;
  onSelect: (todo: TodoFrontMatter) => void;
  onCancel: () => void;
  onQuickAction: (todo: TodoFrontMatter, action: "work" | "refine") => void;
}

function visibleRange(selected: number, total: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(selected - Math.floor(MAX_VISIBLE / 2), total - MAX_VISIBLE));
  return { start, end: Math.min(start + MAX_VISIBLE, total) };
}

/** A searchable list of todos. */
export class TodoSelector extends Container implements Focusable {
  private readonly searchInput = new Input();
  private readonly listContainer = new Container();
  private readonly headerText = new Text("", 1, 0);
  private allTodos: TodoFrontMatter[];
  private filteredTodos: TodoFrontMatter[];
  private selectedIndex = 0;
  private isFocused = false;

  /** Makes the selector with the todos and callbacks in `options`. */
  constructor(private readonly options: TodoSelectorOptions) {
    super();
    this.allTodos = options.todos;
    this.filteredTodos = options.todos;
    this.searchInput.setValue(options.initialSearch);
    this.searchInput.onSubmit = () => this.selectCurrent();
    const { theme } = options;
    addChildren(this, [accentBorder(theme), new Spacer(1), this.headerText, new Spacer(1)]);
    addChildren(this, [this.searchInput, new Spacer(1), this.listContainer, new Spacer(1)]);
    addChildren(this, [new Text(theme.fg("dim", HINTS), 1, 0), new Spacer(1), accentBorder(theme)]);
    this.refresh();
  }

  /** True when the selector has keyboard focus. */
  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.searchInput.focused = value;
  }

  /** Replaces the list of todos. The search text does not change. */
  setTodos(todos: TodoFrontMatter[]): void {
    this.allTodos = todos;
    this.refresh();
    this.options.tui.requestRender();
  }

  /** Moves the selection, selects a todo, or changes the search text. */
  handleInput(keyData: string): void {
    const kb = this.options.keybindings;
    const handled = dispatchKey([
      [kb.matches(keyData, "tui.select.up"), () => this.moveSelection(-1)],
      [kb.matches(keyData, "tui.select.down"), () => this.moveSelection(1)],
      [kb.matches(keyData, "tui.select.confirm"), () => this.selectCurrent()],
      [kb.matches(keyData, "tui.select.cancel"), () => this.options.onCancel()],
      [matchesKey(keyData, Key.ctrlShift("r")), () => this.quickAction("refine")],
      [matchesKey(keyData, Key.ctrlShift("w")), () => this.quickAction("work")],
    ]);
    if (handled) return;
    this.searchInput.handleInput(keyData);
    this.refresh();
  }

  override invalidate(): void {
    super.invalidate();
    this.refresh();
  }

  private refresh(): void {
    this.filteredTodos = filterTodos(this.allTodos, this.searchInput.getValue());
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredTodos.length - 1));
    this.updateHeader();
    this.updateList();
  }

  private updateHeader(): void {
    const open = this.allTodos.filter((todo) => !isTodoClosed(todo.status)).length;
    const title = `Todos (${open} open, ${this.allTodos.length - open} closed)`;
    this.headerText.setText(this.options.theme.fg("accent", this.options.theme.bold(title)));
  }

  private updateList(): void {
    const { theme, currentSessionId } = this.options;
    const total = this.filteredTodos.length;
    this.listContainer.clear();
    if (total === 0) {
      this.listContainer.addChild(new Text(theme.fg("muted", "  No matching todos"), 0, 0));
      return;
    }
    const { start, end } = visibleRange(this.selectedIndex, total);
    this.filteredTodos.slice(start, end).forEach((todo, offset) => {
      const selected = start + offset === this.selectedIndex;
      const line = renderSelectorLine(theme, todo, selected, currentSessionId);
      this.listContainer.addChild(new Text(line, 0, 0));
    });
    if (start > 0 || end < total) {
      const scrollInfo = theme.fg("dim", `  (${this.selectedIndex + 1}/${total})`);
      this.listContainer.addChild(new Text(scrollInfo, 0, 0));
    }
  }

  private moveSelection(delta: number): void {
    const total = this.filteredTodos.length;
    if (total === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + total) % total;
    this.updateList();
  }

  private selectCurrent(): void {
    const selected = this.filteredTodos[this.selectedIndex];
    if (selected) this.options.onSelect(selected);
  }

  private quickAction(action: "work" | "refine"): void {
    const selected = this.filteredTodos[this.selectedIndex];
    if (selected) this.options.onQuickAction(selected, action);
  }
}
