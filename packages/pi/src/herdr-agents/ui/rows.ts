import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { mixColors, sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Subagent, SubagentStatus } from "../provider.ts";

/** The data that `renderAgentRows` uses to draw the subagents. */
export interface RowsContext {
  theme: Theme;
  /** The width of the terminal, in columns. */
  width: number;
  /** The current time in milliseconds. It sets the spinner frame and the elapsed times. */
  now: number;
}

interface StatusLook {
  color: ThemeColor;
  icon: string;
  label: string;
}

interface Layout {
  title: number;
  model: number;
  task: number;
  elapsed: boolean;
}

/** The maximum number of subagent rows. The widget shows a count of the other subagents. */
export const MAX_ROWS = 8;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SPINNER_FRAME_MS = 80;

const BADGE_WIDTH = 9;

const ELAPSED_WIDTH = 6;

const MIN_TASK_WIDTH = 16;

const MAX_TITLE_WIDTH = 18;

const MAX_MODEL_WIDTH = 32;

const BADGE_TINT = 0.7;

const LOOKS: Record<SubagentStatus, StatusLook> = {
  working: { color: "accent", icon: "", label: "WORKING" },
  blocked: { color: "warning", icon: "▲", label: "BLOCKED" },
  done: { color: "success", icon: "✓", label: "DONE" },
  idle: { color: "muted", icon: "○", label: "IDLE" },
  unknown: { color: "dim", icon: "?", label: "UNKNOWN" },
};

const SUMMARY_ORDER: readonly SubagentStatus[] = ["working", "blocked", "done", "idle", "unknown"];

function spinnerFrame(now: number): string {
  return SPINNER[Math.floor(now / SPINNER_FRAME_MS) % SPINNER.length] ?? "⠋";
}

function statusIcon(status: SubagentStatus, now: number): string {
  return status === "working" ? spinnerFrame(now) : LOOKS[status].icon;
}

function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function fit(text: string, width: number): string {
  if (visibleWidth(text) <= width) return padEnd(text, width);

  return padEnd(`${sliceByColumn(text, 0, width - 1, true)}…`, width);
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function border(theme: Theme, text: string): string {
  return theme.fg("borderMuted", text);
}

/** Formats a duration in a short form, for example `42s`, `3m07s`, or `1h05m`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) return `${seconds}s`;

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${two(seconds % 60)}s`;

  return `${Math.floor(seconds / 3600)}h${two(Math.floor(seconds / 60) % 60)}m`;
}

function widest(values: readonly string[], max: number): number {
  return Math.min(max, Math.max(0, ...values.map((value) => visibleWidth(value))));
}

function fixedWidth(layout: Omit<Layout, "task">): number {
  const model = layout.model > 0 ? layout.model + 2 : 0;
  const elapsed = layout.elapsed ? ELAPSED_WIDTH + 1 : 0;

  return 2 + layout.title + 2 + model + 2 + BADGE_WIDTH + elapsed;
}

/**
 * Picks the columns for the inner width. It removes the model column first, then the elapsed
 * time, when the task column becomes too narrow.
 */
export function chooseLayout(agents: readonly Subagent[], inner: number): Layout {
  const title = widest(
    agents.map((agent) => agent.title),
    MAX_TITLE_WIDTH,
  );

  const model = widest(
    agents.map((agent) => agent.model),
    MAX_MODEL_WIDTH,
  );

  const candidates = [
    { title, model, elapsed: true },
    { title, model: 0, elapsed: true },
    { title, model: 0, elapsed: false },
  ];

  const layouts = candidates.map((c) => ({ ...c, task: inner - fixedWidth(c) }));

  return layouts.find((layout) => layout.task >= MIN_TASK_WIDTH) ?? (layouts.at(-1) as Layout);
}

function styleModel(model: string, width: number, theme: Theme): string {
  const text = fit(model, width);
  const slash = text.indexOf("/");

  if (slash < 0) return theme.fg("muted", text);

  return theme.fg("dim", text.slice(0, slash + 1)) + theme.fg("muted", text.slice(slash + 1));
}

function badge(status: SubagentStatus, theme: Theme): string {
  const { color, label } = LOOKS[status];
  const left = Math.floor((BADGE_WIDTH - label.length) / 2);
  const text = padEnd(" ".repeat(left) + label, BADGE_WIDTH);
  const tint = mixColors(theme.colors[color], theme.colors.toolPendingBg, BADGE_TINT, "srgb");

  return theme.style(text, { fg: color, bg: tint, bold: true });
}

function styleTitle(agent: Subagent, width: number, theme: Theme): string {
  const color = agent.status === "blocked" ? "warning" : "text";

  return theme.style(fit(agent.title, width), { fg: color, bold: true });
}

function styleTask(agent: Subagent, width: number, theme: Theme): string {
  const color = agent.status === "working" || agent.status === "blocked" ? "text" : "muted";

  return theme.style(fit(agent.task.replace(/\s+/g, " "), width), { fg: color, italic: true });
}

function agentRow(agent: Subagent, layout: Layout, context: RowsContext): string {
  const { theme, now } = context;
  const icon = theme.fg(LOOKS[agent.status].color, statusIcon(agent.status, now));
  const parts = [`${icon} ${styleTitle(agent, layout.title, theme)}`];

  if (layout.model > 0) parts.push(styleModel(agent.model, layout.model, theme));

  if (layout.task > 0) parts.push(styleTask(agent, layout.task, theme));
  const elapsed = formatElapsed(now - agent.startedAt).padStart(ELAPSED_WIDTH);
  const tail = layout.elapsed ? ` ${theme.fg("dim", elapsed)}` : "";
  parts.push(badge(agent.status, theme) + tail);

  return parts.join("  ");
}

function summary(agents: readonly Subagent[], context: RowsContext): string {
  const { theme, now } = context;

  const parts = SUMMARY_ORDER.flatMap((status) => {
    const count = agents.filter((agent) => agent.status === status).length;

    if (count === 0) return [];
    const { color } = LOOKS[status];

    return [theme.fg(color, `${statusIcon(status, now)} ${count} ${status}`)];
  });

  return parts.join(theme.fg("dim", " · "));
}

function headerWith(title: string, right: string, context: RowsContext): string {
  const { theme } = context;
  const fill = context.width - 6 - visibleWidth(title) - visibleWidth(right);
  const rule = ` ${"─".repeat(Math.max(0, fill))}`;

  return `${border(theme, "╭─ ")}${title}${border(theme, rule)}${right}${border(theme, "─╮")}`;
}

function headerLine(agents: readonly Subagent[], context: RowsContext): string {
  const { theme, width } = context;
  const noun = agents.length === 1 ? "agent" : "agents";
  const count = theme.style(`${agents.length} ${noun}`, { fg: "accent", bold: true });
  const title = `${theme.fg("accent", "◆")} ${count}`;
  const right = ` ${summary(agents, context)} `;
  const roomy = width - 6 - visibleWidth(title) - visibleWidth(right) >= 1;

  return headerWith(title, roomy ? right : "", context);
}

function footerLine(hidden: number, context: RowsContext): string {
  const { theme, width } = context;

  if (hidden === 0) return border(theme, `╰${"─".repeat(width - 2)}╯`);
  const more = theme.fg("muted", ` +${hidden} more `);
  const rule = "─".repeat(Math.max(0, width - 3 - visibleWidth(more)));

  return border(theme, "╰─") + more + border(theme, `${rule}╯`);
}

function boxRow(content: string, inner: number, theme: Theme): string {
  const side = border(theme, "│");

  return `${side} ${padEnd(truncateToWidth(content, inner, "…"), inner)} ${side}`;
}

/**
 * Draws the subagents as a box of rows. Each row shows the status icon, the title, the model, the
 * task, the status badge, and the time since the subagent started. Returns no lines when there are
 * no subagents.
 */
export function renderAgentRows(agents: readonly Subagent[], context: RowsContext): string[] {
  if (agents.length === 0) return [];
  const inner = context.width - 4;
  const shown = agents.slice(0, MAX_ROWS);
  const layout = chooseLayout(shown, inner);
  const rows = shown.map((agent) => boxRow(agentRow(agent, layout, context), inner, context.theme));

  const lines = [
    headerLine(agents, context),
    ...rows,
    footerLine(agents.length - shown.length, context),
  ];

  return lines.map((line) => truncateToWidth(line, context.width, ""));
}
