import type { ContextPart, ContextReport, ContextSection } from "./report.ts";

const BAR_WIDTH = 10;
const MIN_LABEL_WIDTH = 8;
const DEFAULT_WIDTH = 78;

/** Formats a token count in a short form, such as `8.4k` or `1.2M`. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;

  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Formats the part of the context window that `tokens` uses. */
export function formatPercent(tokens: number, total: number): string {
  return total > 0 ? `${((tokens / total) * 100).toFixed(1)}%` : "?";
}

/** Renders the context report as plain text lines of at most `width` characters. */
export function renderContextText(report: ContextReport, width = DEFAULT_WIDTH): string[] {
  const total = report.totalTokens ?? 0;
  const lines = [
    titleLine(report),
    "Token counts are estimates, scaled to pi's total.",
    ...sectionLines(report.sections, total, width),
    ...largestLines(report, total, width),
  ];

  return lines.map((line) => truncate(line, width));
}

function sectionLines(sections: readonly ContextSection[], total: number, width: number): string[] {
  return sections.flatMap((section) => [
    "",
    sectionLine(section, total, width),
    ...section.parts.map((part) => partLine(part, total, width)),
  ]);
}

function largestLines(report: ContextReport, total: number, width: number): string[] {
  if (report.largest.length === 0) return [];

  return ["", "Largest items", ...report.largest.map((part) => partLine(part, total, width))];
}

function titleLine(report: ContextReport): string {
  const total = report.totalTokens ?? 0;
  const usage = `${formatTokens(total)} / ${formatTokens(report.contextWindow)}`;
  const percent = formatPercent(total, report.contextWindow);
  const model = report.model ? ` · ${report.model}` : "";

  return `Context · ${usage} (${percent})${model}`;
}

function sectionLine(section: ContextSection, total: number, width: number): string {
  const right = `${formatTokens(section.tokens)} ${formatPercent(section.tokens, total)}`;

  return columns(section.title, right, width);
}

function partLine(part: ContextPart, total: number, width: number): string {
  const count = part.count && part.count > 1 ? ` (${part.count})` : "";
  const label = `${bar(part.tokens, total)}  ${partLabel(part)}${count}`;

  return columns(label, formatTokens(part.tokens), width, "  ");
}

function partLabel(part: ContextPart): string {
  return part.detail ? `${part.label} · ${part.detail}` : part.label;
}

function bar(tokens: number, total: number): string {
  const fraction = total > 0 ? Math.min(1, tokens / total) : 0;
  const filled = Math.round(fraction * BAR_WIDTH);

  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function columns(label: string, right: string, width: number, prefix = ""): string {
  const available = Math.max(MIN_LABEL_WIDTH, width - prefix.length - right.length - 1);
  const text = truncate(label, available).padEnd(available);

  return `${prefix}${text} ${right}`;
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, Math.max(0, width));

  return `${text.slice(0, width - 1)}…`;
}
