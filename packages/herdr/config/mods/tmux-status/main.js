import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, focused, panes, run, shared, setShared, spaces, theme } from "herdr";
import { rememberPane } from "./history.js";

function pad(n) {
  return String(n).padStart(2, "0");
}

function clock() {
  const date = new Date();
  return `${date.toDateString()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function branchText(pane, dirty) {
  if (!pane?.branch) return "";
  return ` ${pane.branch}${dirty ? " ●" : ""}`;
}

function tabButton(item, t) {
  return div()
    .id(`tab-${item.id}`)
    .px(10)
    .py(4)
    .bg(item.active ? t.selected : t.chrome)
    .text_color(t[item.status] ?? t.foreground)
    .on_click(() => run("tab.select", { id: item.id }))
    .child(item.name);
}

function tabs(space, t) {
  return [
    div()
      .id("picker")
      .on_click(() => run("mod.open", { name: "picker" }))
      .child(space?.name ?? "Herdr"),
    ...(space?.tabs ?? []).map((item) => tabButton(item, t)),
    div()
      .id("new-tab")
      .on_click(() => run("tab.new"))
      .child("+"),
  ];
}

function bar(t) {
  return h_flex()
    .size_full()
    .px(8)
    .gap(8)
    .items_center()
    .bg(t.chrome)
    .text_color(t.foreground)
    .text_size(12);
}

/** The bottom tab bar, Git status, clock, and pane focus history. */
export default class TmuxStatus extends View {
  init(_props, cx) {
    this.dirty = false;
    cx.timer.every(5000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const focus = focused();
      if (!focus?.cwd) return;
      const machine = spaces().find((space) => space.id === focus.space)?.machine;
      const result = await exec("git", ["status", "--porcelain"], { cwd: focus.cwd, on: machine });
      this.dirty = result.code === 0 && result.stdout.trim().length > 0;
      this.dirtyTerminal = focus.terminal;
      cx.notify();
    });
  }

  remember(pane) {
    const history = shared("tmux.history") ?? {};
    const next = rememberPane(history, pane);
    if (next !== history) setShared("tmux.history", next);
  }

  render() {
    const t = theme();
    const pane = panes().find((p) => p.focused);
    this.remember(pane);
    const dirty = this.dirtyTerminal === pane?.terminal && this.dirty;
    const space = spaces().find((s) => s.active);
    return bar(t)
      .children(tabs(space, t))
      .child(div().flex_1())
      .child(div().text_color(t.muted).child(branchText(pane, dirty)))
      .child(div().text_color(t.muted).child(clock()));
  }
}
