import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { formatTodoId } from "../ids.ts";
import { getTodoStatus, isTodoClosed, type TodoRecord } from "../model.ts";
import { dispatchKey, type KeybindingMatcher } from "./shared.ts";

/** The result of the detail overlay: go back to the menu, or work on the todo. */
export type TodoOverlayAction = "back" | "work";

const HEADER_LINES = 3;
const FOOTER_LINES = 3;
const BORDER_LINES = 2;

/** The environment and callback of a {@link TodoDetailOverlay}. */
export interface TodoDetailOverlayOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingMatcher;
  todo: TodoRecord;
  onAction: (action: TodoOverlayAction) => void;
}

/** A framed, scrollable view of the body of one todo. */
export class TodoDetailOverlay implements Component {
  private markdown: Markdown;
  private scrollOffset = 0;
  private viewHeight = 0;
  private totalLines = 0;

  /** Makes the overlay for the todo in `options`. */
  constructor(private readonly options: TodoDetailOverlayOptions) {
    this.markdown = this.buildMarkdown();
  }

  /** Scrolls the body, or closes the overlay with an action. */
  handleInput(keyData: string): void {
    const kb = this.options.keybindings;
    dispatchKey([
      [kb.matches(keyData, "tui.select.cancel"), () => this.options.onAction("back")],
      [kb.matches(keyData, "tui.select.confirm"), () => this.options.onAction("work")],
      [kb.matches(keyData, "tui.select.up"), () => this.scrollBy(-1)],
      [kb.matches(keyData, "tui.select.down"), () => this.scrollBy(1)],
      [
        kb.matches(keyData, "tui.select.pageUp") || matchesKey(keyData, Key.left),
        () => this.scrollBy(-this.viewHeight || -1),
      ],
      [
        kb.matches(keyData, "tui.select.pageDown") || matchesKey(keyData, Key.right),
        () => this.scrollBy(this.viewHeight || 1),
      ],
    ]);
  }

  /** Renders the frame, the title, the metadata, the visible part of the body, and the key hints. */
  render(width: number): string[] {
    const innerWidth = Math.max(10, width - 2);
    const lines = [
      this.buildTitleLine(innerWidth),
      this.buildMetaLine(innerWidth),
      "",
      ...this.visibleBody(innerWidth),
      "",
      this.buildActionLine(innerWidth),
    ];
    return this.frame(lines, innerWidth).map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {
    this.markdown = this.buildMarkdown();
  }

  private buildMarkdown(): Markdown {
    const body = this.options.todo.body.trim() || "_No details yet._";
    return new Markdown(body, 1, 0, getMarkdownTheme());
  }

  private visibleBody(innerWidth: number): string[] {
    const rows = this.options.tui.terminal.rows || 24;
    const maxHeight = Math.max(10, Math.floor(rows * 0.8));
    const contentHeight = Math.max(1, maxHeight - HEADER_LINES - FOOTER_LINES - BORDER_LINES);
    const markdownLines = this.markdown.render(innerWidth);
    this.totalLines = markdownLines.length;
    this.viewHeight = contentHeight;
    this.scrollBy(0);
    const visible = markdownLines.slice(this.scrollOffset, this.scrollOffset + contentHeight);
    const padding = Array.from({ length: contentHeight - visible.length }, () => "");
    return [...visible.map((line) => truncateToWidth(line, innerWidth)), ...padding];
  }

  private frame(lines: string[], innerWidth: number): string[] {
    const side = this.border("│");
    const framed = lines.map((line) => {
      const truncated = truncateToWidth(line, innerWidth);
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
      return side + truncated + padding + side;
    });
    const horizontal = "─".repeat(innerWidth);
    return [this.border(`┌${horizontal}┐`), ...framed, this.border(`└${horizontal}┘`)];
  }

  private border(text: string): string {
    return this.options.theme.fg("borderMuted", text);
  }

  private buildTitleLine(width: number): string {
    const { theme, todo } = this.options;
    const titleText = todo.title ? ` ${todo.title} ` : ` Todo ${formatTodoId(todo.id)} `;
    const titleWidth = visibleWidth(titleText);
    if (titleWidth >= width) return truncateToWidth(theme.fg("accent", titleText.trim()), width);
    const leftWidth = Math.floor((width - titleWidth) / 2);
    const rightWidth = width - titleWidth - leftWidth;
    return (
      theme.fg("borderMuted", "─".repeat(leftWidth)) +
      theme.fg("accent", titleText) +
      theme.fg("borderMuted", "─".repeat(rightWidth))
    );
  }

  private buildMetaLine(width: number): string {
    const { theme, todo } = this.options;
    const status = getTodoStatus(todo);
    const separator = theme.fg("muted", " • ");
    const line = [
      theme.fg("accent", formatTodoId(todo.id)),
      theme.fg(isTodoClosed(status) ? "dim" : "success", status),
      theme.fg("muted", todo.tags.length ? todo.tags.join(", ") : "no tags"),
    ].join(separator);
    return truncateToWidth(line, width);
  }

  private buildActionLine(width: number): string {
    const { theme } = this.options;
    const line = [
      theme.fg("accent", "enter") + theme.fg("muted", " work on todo"),
      theme.fg("dim", "esc back"),
      theme.fg("dim", "↑/↓: move. ←/→: page."),
    ].join(theme.fg("muted", " • "));
    return truncateToWidth(line + this.scrollInfo(), width);
  }

  private scrollInfo(): string {
    if (this.totalLines <= this.viewHeight) return "";
    const start = Math.min(this.totalLines, this.scrollOffset + 1);
    const end = Math.min(this.totalLines, this.scrollOffset + this.viewHeight);
    return this.options.theme.fg("dim", ` ${start}-${end}/${this.totalLines}`);
  }

  private scrollBy(delta: number): void {
    const maxScroll = Math.max(0, this.totalLines - this.viewHeight);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, maxScroll));
  }
}
