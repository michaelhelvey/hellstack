// The banner over the main area: it names who the shown tab talks to, the coordinator or the
// worker of a task, with a different accent for each.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run } from "herdr";

import { pill, spinner } from "./board.js";
import { progress, repoName, summary } from "./model.js";

function band(accent) {
  return h_flex()
    .size_full()
    .items_center()
    .gap(14)
    .pl(12)
    .pr(14)
    .bg(accent + "2e")
    .border_b_2()
    .border_color(accent)
    .child(div().flex_none().w(6).h(36).rounded(3).bg(accent));
}

function role(text, accent) {
  return div().flex_none().text_size(18).font_weight(800).text_color(accent).child(text);
}

function counts(t, data) {
  const items = summary(data);
  return h_flex()
    .flex_none()
    .gap(6)
    .children(items.map((text) => pill(text, text.endsWith("on you") ? t.blocked : t.muted)));
}

function coordinator(t, data) {
  const accent = t.ansi5;
  return band(accent)
    .child(role("COORDINATOR", accent))
    .child(div().flex_1().truncate().text_color(t.muted).child("plans tasks and starts workers"))
    .child(counts(t, data));
}

function details(t, task) {
  const parts = [repoName(task.repo), task.status, progress(task), task.now].filter(Boolean);
  return h_flex()
    .gap(8)
    .text_size(12)
    .text_color(t.muted)
    .child(div().flex_1().min_w(0).truncate().child(parts.join("  ·  ")));
}

function back(t) {
  return div()
    .id("fb-back")
    .flex_none()
    .px(8)
    .py(4)
    .rounded(6)
    .border_1()
    .border_color(t.border)
    .text_color(t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(() => run("tab.select", { id: "tbfactory" }))
    .child("← coordinator");
}

function taskText(t, id, task) {
  if (!task) return div().flex_1().text_color(t.dim).child(`task ${id} is not on the board`);
  const title = h_flex()
    .gap(8)
    .items_center()
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(14)
        .font_weight(600)
        .text_color(t.foreground)
        .child(task.title),
    )
    .when(task.needs_you, (el) => el.child(pill("needs you", t.blocked)))
    .when(task.working, (el) => el.child(spinner(t.working)));
  return v_flex().flex_1().min_w(0).gap(1).child(title).child(details(t, task));
}

function worker(t, id, data) {
  const accent = t.ansi6;
  const task = data.tasks.find((task) => task.id === id);
  return band(accent)
    .child(role("WORKER", accent))
    .child(pill(id, accent))
    .child(taskText(t, id, task))
    .child(back(t));
}

function other(t) {
  return band(t.dim).child(role("NOT A FACTORY TAB", t.dim)).child(div().flex_1()).child(back(t));
}

/**
 * Returns the banner for `shown` (from `shownRole`). `data` is the shared board data: `{ tasks,
 * inbox }`.
 */
export function banner(t, shown, data) {
  if (shown.role === "coordinator") return coordinator(t, data);
  if (shown.role === "worker") return worker(t, shown.id, data);
  return other(t);
}
