// The board views: "needs you", the task groups, the inbox, the source health, and the feed.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, terminals } from "herdr";

import {
  ROLE_ACCENTS,
  age,
  clock,
  inboxCount,
  inboxPage,
  inboxThreads,
  kindLabel,
  openable,
  progress,
  repoName,
  sections,
  threadLabel,
} from "./model.js";

/** Returns a small bold heading. */
export function heading(t, text, color) {
  return div()
    .text_size(10)
    .font_weight(700)
    .text_color(color ?? t.dim)
    .child(text);
}

function countHeading(t, label, count) {
  return heading(t, `${label.toUpperCase()} · ${count}`, count > 0 ? t.muted : t.dim);
}

/** Returns a small label on a faint background of `color`. */
export function pill(text, color) {
  return div()
    .flex_none()
    .px(5)
    .h(16)
    .flex()
    .items_center()
    .rounded(4)
    .bg(color + "26")
    .text_size(10)
    .text_color(color)
    .child(text);
}

/** Returns the turning spinner that shows a working agent. */
export function spinner(color) {
  return svg("mods/workspace-chrome/spinner.svg").size(11).text_color(color).spin(900);
}

function stateIcon(t, task, status) {
  if (task.paused) return pill("paused", t.muted);
  if (status === "working") return spinner(t.working);
  if (status === "blocked") return div().size(6).rounded_full().bg(t.blocked);
  return null;
}

function clickable(el, t, onClick) {
  return el
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(onClick);
}

/**
 * Returns a function that gives the agent status of a task: the live status of its terminal, else
 * `working` from the last board load.
 */
export function liveStatus() {
  const live = new Map(terminals().map((terminal) => [terminal.address, terminal.status]));
  return (task) => (live.has(task.terminal) ? live.get(task.terminal) : task.working && "working");
}

function frame(el, ctx, task) {
  const { t, shown } = ctx;
  const accent = t[ROLE_ACCENTS.worker];
  return el
    .when(task.paused, (el) => el.opacity(0.5))
    .when(task.id === shown, (el) =>
      el
        .border_1()
        .border_color(accent)
        .bg(accent + "1a"),
    )
    .when(Boolean(task.terminal), (el) =>
      clickable(el, t, () => run("agent.focus", { terminal: task.terminal })),
    );
}

function cardTop(ctx, task) {
  const { t } = ctx;
  const icon = stateIcon(t, task, ctx.statusOf(task));
  return h_flex()
    .gap(6)
    .items_center()
    .text_size(11)
    .text_color(t.dim)
    .child(div().flex_1().truncate().child(repoName(task.repo)))
    .child(div().flex_none().text_color(t.muted).child(progress(task)))
    .when(Boolean(icon), (el) => el.child(icon));
}

function card(ctx, task) {
  const { t } = ctx;
  const el = v_flex()
    .id(`fb-${task.id}`)
    .gap(2)
    .px(9)
    .py(7)
    .rounded(7)
    .bg(t.foreground + "08")
    .child(cardTop(ctx, task))
    .child(div().truncate().text_color(t.foreground).child(task.title))
    .when(Boolean(task.now), (el) => el.child(div().truncate().text_color(t.dim).child(task.now)));
  return frame(el, ctx, task);
}

function line(ctx, task) {
  const { t } = ctx;
  const icon = stateIcon(t, task, ctx.statusOf(task));
  const el = h_flex()
    .id(`fb-${task.id}`)
    .gap(8)
    .px(9)
    .py(3)
    .rounded(5)
    .items_center()
    .child(div().flex_none().w(120).truncate().text_color(t.dim).child(repoName(task.repo)))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(task.title))
    .when(Boolean(icon), (el) => el.child(icon));
  return frame(el, ctx, task);
}

function needsYou(ctx, tasks) {
  const { t } = ctx;
  if (tasks.length === 0) return heading(t, "NEEDS YOU · 0");
  return v_flex()
    .gap(6)
    .p(8)
    .rounded(9)
    .border_1()
    .border_color(t.blocked + "88")
    .bg(t.blocked + "1a")
    .child(heading(t, `NEEDS YOU · ${tasks.length}`, t.blocked))
    .children(
      tasks.map((task) => card(ctx, task).child(div().text_color(t.blocked).child(task.needs_you))),
    );
}

function group(ctx, { label, size, tasks }) {
  const draw = size === "full" ? card : line;
  return v_flex()
    .gap(size === "full" ? 5 : 1)
    .child(countHeading(ctx.t, label, tasks.length))
    .children(tasks.map((task) => draw(ctx, task)));
}

function inboxCells(ctx, { latest, count }) {
  const { t } = ctx;
  const color = latest.source === "sentry" ? t.ansi3 : t.accent;
  const thread = threadLabel(latest.thread);
  return [
    div()
      .flex_none()
      .w(76)
      .child(pill(kindLabel(latest.kind), color)),
    div().flex_none().max_w(170).truncate().text_color(t.muted).child(thread),
    div().flex_1().min_w(0).truncate().text_color(t.foreground).child(latest.title),
    div()
      .flex_none()
      .text_color(t.dim)
      .child(count > 1 ? `×${count}` : ""),
    div().flex_none().w(30).text_color(t.dim).child(age(latest.ts, ctx.now)),
  ];
}

function inboxRow(ctx, thread) {
  const { latest } = thread;
  return h_flex()
    .id(`fb-in-${latest.id ?? latest.thread}`)
    .gap(8)
    .px(6)
    .py(3)
    .rounded(5)
    .items_center()
    .when(openable(latest.url), (el) => clickable(el, ctx.t, (_e, cx) => cx.open_url(latest.url)))
    .children(inboxCells(ctx, thread));
}

function inbox(ctx, items) {
  const { t } = ctx;
  const { shown, more } = inboxPage(inboxThreads(items), ctx.inboxOpen);
  const toggle = div()
    .id("fb-in-more")
    .px(6)
    .py(3)
    .rounded(5)
    .text_color(t.dim)
    .child(more > 0 ? `+${more} more` : "show less");
  const color = items.length > 0 ? t.muted : t.dim;
  return v_flex()
    .gap(1)
    .child(heading(t, `INBOX · ${inboxCount(items)}`, color))
    .children(shown.map((thread) => inboxRow(ctx, thread)))
    .when(more > 0 || ctx.inboxOpen, (el) => el.child(clickable(toggle, t, ctx.toggleInbox)));
}

function source(t, s, now) {
  return h_flex()
    .gap(4)
    .child(div().text_color(t.muted).child(s.source))
    .child(
      div()
        .text_color(s.ok ? t.done : t.blocked)
        .child(s.ok ? "✓" : "✗"),
    )
    .child(
      div()
        .text_color(t.dim)
        .child(`${age(s.ts, now)} ago`),
    );
}

function health(ctx, sources) {
  const { t } = ctx;
  if (sources.length === 0) return div().text_color(t.dim).child("no source has polled yet");
  return h_flex()
    .flex_wrap()
    .gap(12)
    .text_size(11)
    .children(sources.map((s) => source(t, s, ctx.now)));
}

function feedLine(t, item) {
  return h_flex()
    .gap(6)
    .items_start()
    .text_size(11)
    .child(div().flex_none().text_color(t.dim).child(clock(item.ts)))
    .child(div().flex_1().min_w(0).text_color(t.muted).child(item.summary));
}

function feed(ctx, items) {
  const { t } = ctx;
  if (items.length === 0) return heading(t, "FEED · 0");
  return v_flex()
    .gap(4)
    .child(heading(t, "FEED", t.muted))
    .children([...items].reverse().map((item) => feedLine(t, item)));
}

function stack(blocks) {
  return v_flex().flex_1().min_w(0).gap(16).children(blocks);
}

function blocks(ctx, board) {
  const { needsYou: asks, groups } = sections(board);
  const active = groups.filter((g) => g.status !== "landed");
  const landed = groups.filter((g) => g.status === "landed");
  return {
    tasks: [needsYou(ctx, asks), ...active.map((g) => group(ctx, g))],
    landed: landed.map((g) => group(ctx, g)),
    inbox: inbox(ctx, board.inbox),
    rest: [health(ctx, board.sources), feed(ctx, board.feed)],
  };
}

/**
 * Returns the board content. `ctx`: `{ t, now, statusOf, shown, wide, inboxOpen, toggleInbox }`.
 * When `wide` is true, the tasks are in the left column and the inbox, the source health, and the
 * feed are in the right column.
 */
export function boardBody(ctx, board) {
  const { tasks, landed, inbox, rest } = blocks(ctx, board);
  if (!ctx.wide) return stack([...tasks, inbox, ...landed, ...rest]);
  return h_flex()
    .items_start()
    .gap(20)
    .child(stack([...tasks, ...landed]))
    .child(stack([inbox, ...rest]));
}
