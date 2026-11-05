// The board: a header with the power switch, the new task button, and the source health, the
// tasks, the inbox, and the feed. It uses two columns when it is wide.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

import { powerState } from "./actions.js";
import { inboxColumn } from "./inbox.js";
import { age, clock } from "./model.js";
import { taskColumn } from "./tasks.js";
import { actionLine, busyLine, button, dot, heading, pill, some, spinner } from "./ui.js";

/** The board width, in px, from which the tasks and the inbox are side by side. */
export const TWO_COLUMNS_PX = 760;

const PADDING = 16;
const GAP = 20;

const START = ["up", "start"];
const STOP = ["down", "stop"];

const POWER = {
  running: { text: "running", color: "done", buttons: [STOP] },
  partial: { text: "partly running", color: "ansi3", buttons: [START, STOP] },
  stopped: { text: "stopped", color: "dim", buttons: [START] },
  unknown: { text: "…", color: "dim", buttons: [] },
};

function partText(running) {
  if (!running) return "";
  const parts = [
    ["factoryd", running.factoryd],
    ["coordinator", running.coordinator],
  ];
  return parts.map(([name, on]) => `${name} ${on ? "runs" : "is stopped"}`).join(", ");
}

function powerButton(ctx, [next, label]) {
  const { t } = ctx;
  const solid = next === "up";
  return button(ctx, {
    id: `fb-power-${next}`,
    text: label,
    color: solid ? t.done : t.muted,
    solid,
    tooltip: `bun run factory ${next}`,
    onClick: (_e, cx) => ctx.power(next, cx),
  });
}

function powerFrame(color, running) {
  return h_flex()
    .id("fb-power-state")
    .flex_none()
    .gap(8)
    .items_center()
    .pl(10)
    .pr(4)
    .py(3)
    .rounded(8)
    .border_1()
    .border_color(color + "66")
    .bg(color + "14")
    .tooltip(partText(running));
}

function powerText(ctx, color, text) {
  return div().text_size(ctx.fs.small).font_weight(600).text_color(color).child(text);
}

function power(ctx, running) {
  const { t } = ctx;
  const spec = POWER[powerState(running)];
  const frame = powerFrame(t[spec.color], running);
  const state = ctx.actions.get("power");
  if (state?.phase === "busy") {
    return frame
      .pr(10)
      .child(spinner(t.working))
      .child(powerText(ctx, t.working, state.text));
  }
  return frame
    .child(dot(t[spec.color], 8))
    .child(powerText(ctx, t[spec.color], spec.text))
    .children(spec.buttons.map((pair) => powerButton(ctx, pair)));
}

function sketchButton(ctx) {
  const state = ctx.actions.get("sketch");
  if (state?.phase === "busy") return busyLine(ctx, state.text);
  return button(ctx, {
    id: "fb-sketch",
    text: "+ new task",
    color: ctx.t.ansi3,
    tooltip: "bun run factory design: a new sketch and its design agent",
    onClick: (_e, cx) => ctx.sketch(cx),
  });
}

function source(ctx, s) {
  const { t } = ctx;
  const color = s.ok ? t.done : t.blocked;
  const text = div().text_color(s.ok ? t.dim : t.blocked);
  return h_flex()
    .id(`fb-src-${s.source}`)
    .flex_none()
    .gap(4)
    .items_center()
    .tooltip(s.summary)
    .child(dot(color, 6))
    .child(text.child(`${s.source} ${age(s.ts, ctx.now)}`));
}

function sources(ctx, board) {
  return h_flex()
    .flex_none()
    .gap(12)
    .text_size(ctx.fs.tiny)
    .children(board.sources.map((s) => source(ctx, s)));
}

function title(ctx) {
  const { t, fs } = ctx;
  return div().flex_none().text_size(fs.big).font_weight(700).text_color(t.foreground);
}

function headerRow(ctx, board) {
  const bad = board.invalid > 0 && pill(ctx, `${board.invalid} bad task files`, ctx.t.blocked);
  return h_flex()
    .flex_wrap()
    .gap(12)
    .items_center()
    .child(title(ctx).child("Factory"))
    .child(power(ctx, board.running))
    .child(sketchButton(ctx))
    .child(div().flex_1())
    .children(some(bad))
    .child(sources(ctx, board));
}

function doneLine(ctx, key) {
  return ctx.actions.get(key)?.phase !== "busy" && actionLine(ctx, key);
}

function header(ctx, board) {
  const loadError = div().text_size(ctx.fs.small).text_color(ctx.t.blocked).child(ctx.error);
  return v_flex()
    .gap(6)
    .child(headerRow(ctx, board))
    .children(some(doneLine(ctx, "power")))
    .children(some(doneLine(ctx, "sketch")))
    .children(some(Boolean(ctx.error) && loadError));
}

function feedLine(ctx, item) {
  const { t } = ctx;
  return h_flex()
    .gap(8)
    .items_start()
    .text_size(ctx.fs.tiny)
    .child(div().flex_none().text_color(t.dim).child(clock(item.ts)))
    .child(div().flex_none().w(64).truncate().text_color(t.dim).child(item.source))
    .child(div().flex_1().min_w(0).text_color(t.muted).child(item.summary));
}

function feed(ctx, items) {
  if (items.length === 0) return heading(ctx, "Feed · 0");
  return v_flex()
    .gap(3)
    .child(heading(ctx, "Feed", ctx.t.muted))
    .children([...items].reverse().map((item) => feedLine(ctx, item)));
}

function column(width, blocks) {
  return v_flex().flex_none().w(width).min_w(0).gap(20).children(blocks);
}

function narrow(ctx, board, width) {
  const blocks = [taskColumn(ctx, board), inboxColumn(ctx, board, width), feed(ctx, board.feed)];
  return column(width, blocks);
}

function wide(ctx, board, width) {
  const left = Math.floor((width - GAP) * 0.4);
  const right = width - GAP - left;
  return h_flex()
    .items_start()
    .gap(GAP)
    .child(column(left, [taskColumn(ctx, board), feed(ctx, board.feed)]))
    .child(column(right, [inboxColumn(ctx, board, right)]));
}

/**
 * Returns the board content for `width` px. `ctx` has the theme `t`, the text sizes `fs`, the
 * action states, and the click handlers (see main.js). When the board is
 * {@link TWO_COLUMNS_PX} or wider, the tasks and the feed are on the left (two fifths) and the
 * inbox is on the right.
 */
export function boardBody(ctx, board, width) {
  const inner = Math.max(0, width - 2 * PADDING);
  const body = inner < TWO_COLUMNS_PX - 2 * PADDING ? narrow : wide;
  return v_flex()
    .gap(18)
    .child(header(ctx, board))
    .child(body(ctx, board, inner));
}

/** The padding of the board, in px. */
export const BOARD_PADDING = PADDING;
