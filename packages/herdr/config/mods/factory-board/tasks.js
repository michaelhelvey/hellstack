// The task column: the tasks that need you, then a lane for each status. A click on a task opens
// its agent (`factory open <id>`).

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals } from "herdr";

import { ROLE_ACCENTS, STATUS_COLORS, folderName, progress, sections, tildePath } from "./model.js";
import { actionLine, clickable, dot, heading, icon, pill, some, spinner } from "./ui.js";

/**
 * Returns a function that tells if the agent of a task works now: the live status of its
 * terminal (by address or name), else `working` from the last board load.
 */
export function liveWorking() {
  const live = new Map();
  for (const terminal of terminals()) {
    live.set(terminal.address, terminal.status);
    live.set(terminal.name, terminal.status);
  }
  return (agent) =>
    live.has(agent?.terminal) ? live.get(agent.terminal) === "working" : Boolean(agent?.working);
}

function statusColor(t, task) {
  return task.paused ? t.dim : t[STATUS_COLORS[task.status] ?? "muted"];
}

function statusTag(ctx, task) {
  const color = statusColor(ctx.t, task);
  return h_flex()
    .flex_none()
    .gap(5)
    .items_center()
    .text_size(ctx.fs.tiny)
    .font_weight(700)
    .text_color(color)
    .child(dot(color, 6))
    .child(task.paused ? `${task.status} · paused` : task.status);
}

function agentTag(ctx, agent) {
  if (!agent) return false;
  const color = ctx.t[ROLE_ACCENTS[agent.role] ?? "muted"];
  return h_flex()
    .flex_none()
    .gap(4)
    .items_center()
    .child(pill(ctx, agent.role, color))
    .when(ctx.working(agent), (el) => el.child(spinner(color)));
}

function folderTag(ctx, task) {
  const { t } = ctx;
  return h_flex()
    .id(`fb-cwd-${task.id}`)
    .flex_none()
    .max_w(220)
    .gap(4)
    .items_center()
    .text_size(ctx.fs.small)
    .text_color(t.muted)
    .tooltip(tildePath(task.cwd, ctx.home))
    .child(icon("folder", 12, t.dim))
    .child(div().truncate().child(folderName(task.cwd)));
}

function bar(t, share, color) {
  const fill = div()
    .h_full()
    .w(`${Math.round(share * 100)}%`)
    .rounded(2)
    .bg(color);
  return div()
    .flex_1()
    .h(3)
    .rounded(2)
    .bg(t.foreground + "14")
    .child(fill);
}

function progressBar(ctx, task) {
  const { done, total } = task.landing;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  const text = div().flex_none().text_size(ctx.fs.tiny).text_color(ctx.t.dim);
  return h_flex()
    .gap(8)
    .items_center()
    .child(bar(ctx.t, share, statusColor(ctx.t, task)))
    .child(text.child(progress(task)));
}

function frame(ctx, el, task) {
  const { t, shown } = ctx;
  const accent = t[ROLE_ACCENTS[shown.role]];
  const key = `task:${task.id}`;
  return clickable(el, t, (_e, cx) => ctx.openTask(task.id, cx))
    .tooltip(`open the agent of ${task.id}`)
    .when(task.id === shown.id, (el) =>
      el
        .border_1()
        .border_color(accent)
        .bg(accent + "1a"),
    )
    .children(some(actionLine(ctx, key)));
}

function meta(ctx, task) {
  return h_flex()
    .gap(8)
    .items_center()
    .child(folderTag(ctx, task))
    .children(some(agentTag(ctx, task.agent)))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(ctx.fs.small)
        .text_color(ctx.t.dim)
        .child(task.now),
    )
    .child(div().flex_none().text_size(ctx.fs.tiny).text_color(ctx.t.dim).child(task.id));
}

function card(ctx, task) {
  const { t } = ctx;
  const el = v_flex()
    .id(`fb-${task.id}`)
    .gap(5)
    .px(11)
    .py(9)
    .rounded(8)
    .bg(t.foreground + "08")
    .when(task.paused, (el) => el.opacity(0.6))
    .child(statusTag(ctx, task))
    .child(div().text_size(ctx.fs.big).font_weight(600).text_color(t.foreground).child(task.title))
    .child(meta(ctx, task))
    .when(task.landing.total > 0 && progress(task) !== "", (el) => el.child(progressBar(ctx, task)))
    .when(Boolean(task.needs_you), (el) =>
      el.child(div().text_color(t.blocked).text_size(ctx.fs.base).child(task.needs_you)),
    );
  return frame(ctx, el, task);
}

function line(ctx, task) {
  const { t } = ctx;
  const row = h_flex()
    .gap(8)
    .items_center()
    .child(dot(statusColor(t, task), 6))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(task.title))
    .children(some(task.paused && pill(ctx, "paused", t.dim)))
    .children(some(agentTag(ctx, task.agent)))
    .child(folderTag(ctx, task));
  const el = v_flex()
    .id(`fb-${task.id}`)
    .gap(3)
    .px(10)
    .py(5)
    .rounded(6)
    .when(task.paused, (el) => el.opacity(0.6))
    .child(row);
  return frame(ctx, el, task);
}

function lane(ctx, { status, label, size, tasks }) {
  const { t } = ctx;
  const color = tasks.length > 0 ? t[STATUS_COLORS[status]] : t.dim;
  const draw = size === "full" ? card : line;
  return v_flex()
    .gap(size === "full" ? 6 : 1)
    .child(heading(ctx, `${label} · ${tasks.length}`, color))
    .children(tasks.map((task) => draw(ctx, task)));
}

function needsYou(ctx, tasks) {
  const { t } = ctx;
  if (tasks.length === 0) return false;
  return v_flex()
    .gap(6)
    .p(8)
    .rounded(10)
    .border_1()
    .border_color(t.blocked + "88")
    .bg(t.blocked + "14")
    .child(heading(ctx, `Needs you · ${tasks.length}`, t.blocked))
    .children(tasks.map((task) => card(ctx, task)));
}

/** Returns the tasks: "needs you" (when there are any), then the lanes of each status. */
export function taskColumn(ctx, board) {
  const { needsYou: asks, groups } = sections(board);
  return v_flex()
    .gap(16)
    .when(asks.length > 0, (el) => el.child(needsYou(ctx, asks)))
    .children(groups.map((group) => lane(ctx, group)));
}
