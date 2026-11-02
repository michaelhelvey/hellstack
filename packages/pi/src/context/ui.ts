import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import { formatPercent, formatTokens, renderContextText } from "./render.ts";
import type { ContextReport } from "./report.ts";

const HEADER_LINES = 2;
const FOOTER_LINES = 2;
const BORDER_LINES = 2;
const MIN_INNER_WIDTH = 12;

/** The environment and callback of a {@link ContextOverlay}. */
export interface ContextOverlayOptions {
  tui: TUI;
  theme: Theme;
  keybindings: Pick<KeybindingsManager, "matches">;
  report: ContextReport;
  /** Closes the overlay. */
  done: () => void;
}

/** A framed, scrollable view of the context report. */
export class ContextOverlay implements Component {
  private readonly lines: string[];
  private offset = 0;
  private viewHeight = 1;
  private totalLines = 0;

  /** Makes the overlay for the report in `options`. */
  constructor(private readonly options: ContextOverlayOptions) {
    this.lines = renderContextText(options.report);
  }

  /** Scrolls the report, or closes the overlay. */
  handleInput(keyData: string): void {
    if (this.options.keybindings.matches(keyData, "tui.select.cancel")) {
      this.options.done();
      return;
    }

    this.scrollBy(this.scrollDelta(keyData));
  }

  /** Renders the frame, the title, the visible part of the report, and the key hints. */
  render(width: number): string[] {
    const innerWidth = Math.max(MIN_INNER_WIDTH, width - 2);
    const bodyHeight = this.bodyHeight();
    this.viewHeight = bodyHeight;
    this.totalLines = this.lines.length;
    this.clamp();

    const body = this.lines.slice(this.offset, this.offset + bodyHeight);
    const padding = Array.from({ length: bodyHeight - body.length }, () => "");
    const rows = [
      this.title(innerWidth),
      "",
      ...body.map((line) => truncateToWidth(line, innerWidth)),
      ...padding,
      "",
      this.footer(innerWidth),
    ];

    return this.frame(rows, innerWidth).map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}

  private scrollDelta(keyData: string): number {
    const kb = this.options.keybindings;
    if (kb.matches(keyData, "tui.select.pageUp")) return -this.viewHeight;
    if (kb.matches(keyData, "tui.select.pageDown")) return this.viewHeight;

    return this.lineDelta(keyData);
  }

  private lineDelta(keyData: string): number {
    const kb = this.options.keybindings;
    if (kb.matches(keyData, "tui.select.up")) return -1;
    if (kb.matches(keyData, "tui.select.down")) return 1;

    return 0;
  }

  private bodyHeight(): number {
    const rows = this.options.tui.terminal.rows || 24;
    const maxHeight = Math.max(10, Math.floor(rows * 0.85));

    return Math.max(1, maxHeight - HEADER_LINES - FOOTER_LINES - BORDER_LINES);
  }

  private title(width: number): string {
    const { report, theme } = this.options;
    const total = report.totalTokens ?? 0;
    const usage = `${formatTokens(total)} / ${formatTokens(report.contextWindow)}`;
    const percent = formatPercent(total, report.contextWindow);
    const model = report.model ? ` · ${report.model}` : "";
    const text = ` Context · ${usage} (${percent})${model} `;

    return theme.fg("accent", truncateToWidth(text, width));
  }

  private footer(width: number): string {
    const keys =
      this.totalLines > this.viewHeight
        ? "↑/↓ a scroll · PgUp/PgDn a page · esc to close"
        : "esc to close";

    return this.options.theme.fg("dim", truncateToWidth(keys, width));
  }

  private frame(lines: string[], innerWidth: number): string[] {
    const side = this.options.theme.fg("borderMuted", "│");
    const framed = lines.map((line) => {
      const text = truncateToWidth(line, innerWidth);
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(text)));

      return side + text + padding + side;
    });
    const horizontal = "─".repeat(innerWidth);

    return [
      this.options.theme.fg("borderMuted", `┌${horizontal}┐`),
      ...framed,
      this.options.theme.fg("borderMuted", `└${horizontal}┘`),
    ];
  }

  private scrollBy(delta: number): void {
    this.offset += delta;
    this.clamp();
    this.options.tui.requestRender();
  }

  private clamp(): void {
    const maxOffset = Math.max(0, this.totalLines - this.viewHeight);
    this.offset = Math.max(0, Math.min(this.offset, maxOffset));
  }
}
