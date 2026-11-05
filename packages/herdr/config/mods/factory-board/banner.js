// The banner over the main area: it names who the shown tab talks to (the coordinator, the worker
// of a task, or the design agent of a task) with a different accent for each. On other tabs it is
// quiet.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run } from "herdr";

import { powerState } from "./actions.js";
import { ROLE_ACCENTS, folderName, progress, summary } from "./model.js";
import { liveWorking } from "./tasks.js";
import { dot, pill, some, spinner } from "./ui.js";

const ROLE_TEXT = { coordinator: "COORDINATOR", worker: "WORKER", design: "DESIGN" };

function band(ctx, accent) {
  return h_flex()
    .size_full()
    .items_center()
    .gap(10)
    .pr(10)
    .text_size(ctx.fs.base)
    .bg(accent + "1f")
    .border_b_1()
    .border_color(accent + "88")
    .child(div().flex_none().w(4).h_full().bg(accent));
}

function role(ctx, shown, accent) {
  return div().flex_none().font_weight(700).text_color(accent).child(ROLE_TEXT[shown.role]);
}

function back(ctx) {
  const { t } = ctx;
  return div()
    .id("fb-back")
    .flex_none()
    .px(7)
    .py(1)
    .rounded(5)
    .text_size(ctx.fs.small)
    .text_color(t.dim)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(() => run("tab.select", { id: "tbfactory" }))
    .child("← coordinator");
}

function stopped(ctx, data) {
  const state = powerState(data.running);
  if (state === "running" || state === "unknown") return false;
  return pill(ctx, state === "stopped" ? "factory stopped" : "partly running", ctx.t.ansi3);
}

function counts(ctx, data) {
  const { t } = ctx;
  return h_flex()
    .flex_none()
    .gap(6)
    .when(Boolean(data.error), (el) => el.child(pill(ctx, "the board cannot load", t.blocked)))
    .children(some(stopped(ctx, data)))
    .children(
      summary(data).map((text) => pill(ctx, text, text.endsWith("on you") ? t.blocked : t.muted)),
    );
}

function coordinator(ctx, shown, data) {
  const accent = ctx.t[ROLE_ACCENTS.coordinator];
  return band(ctx, accent)
    .child(role(ctx, shown, accent))
    .child(div().flex_1().truncate().text_color(ctx.t.dim).child("plans tasks and starts workers"))
    .child(counts(ctx, data));
}

function titleText(ctx) {
  return div().flex_none().max_w("50%").truncate().font_weight(600).text_color(ctx.t.foreground);
}

function taskText(ctx, shown, task) {
  const { t } = ctx;
  if (!task) return div().flex_1().text_color(t.dim).child(`task ${shown.id} is not on the board`);
  const parts = [folderName(task.cwd), task.status, progress(task), task.now].filter(Boolean);
  return h_flex()
    .flex_1()
    .min_w(0)
    .gap(10)
    .items_center()
    .child(titleText(ctx).child(task.title))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(parts.join(" · ")))
    .when(Boolean(task.needs_you), (el) => el.child(pill(ctx, "needs you", t.blocked)))
    .when(liveWorking()(task.agent), (el) => el.child(spinner(t.working)));
}

function agent(ctx, shown, data) {
  const accent = ctx.t[ROLE_ACCENTS[shown.role]];
  const task = data.tasks.find((task) => task.id === shown.id);
  return band(ctx, accent)
    .child(role(ctx, shown, accent))
    .child(div().flex_none().text_color(accent).child(shown.id))
    .child(taskText(ctx, shown, task))
    .child(back(ctx));
}

function other(ctx) {
  const { t } = ctx;
  return h_flex()
    .size_full()
    .items_center()
    .gap(8)
    .px(12)
    .text_size(ctx.fs.small)
    .text_color(t.dim)
    .child(dot(t.dim, 5))
    .child(div().flex_1().child("not a factory agent"))
    .child(back(ctx));
}

/**
 * Returns the banner for `shown` (from `shownRole`). `ctx`: `{ t, fs }`. `data` is the shared
 * board data (see `bannerData`).
 */
export function banner(ctx, shown, data) {
  if (shown.role === "coordinator") return coordinator(ctx, shown, data);
  if (shown.role === "other") return other(ctx);
  return agent(ctx, shown, data);
}
