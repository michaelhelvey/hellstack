import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

function keycap(key, t) {
  return div()
    .min_w(23)
    .h(23)
    .px(6)
    .flex()
    .items_center()
    .justify_center()
    .rounded(5)
    .border(1)
    .border_color(t.input)
    .bg(t.raised)
    .font_family("Geist Mono")
    .text_size(11)
    .text_color(t.accent)
    .child(key);
}

function row(keys, label, t, choose) {
  const item = h_flex()
    .h(31)
    .gap(7)
    .items_center()
    .child(div().flex_1().text_size(12.5).child(label))
    .children(keys.map((key) => keycap(key, t)));
  if (keys.length !== 1) return item;
  return item
    .id(`prefix-${keys[0]}`)
    .cursor_pointer()
    .hover((style) => style.bg(t.hover).rounded(5))
    .on_click(() => choose(keys[0]));
}

function group(title, rows, t, choose) {
  return v_flex()
    .gap(5)
    .child(div().pb(3).font_semibold().text_size(10).text_color(t.dim).child(title))
    .children(rows.map(([keys, label]) => row(keys, label, t, choose)));
}

const PANES = [
  [["%"], "Split right"],
  [['"'], "Split down"],
  [["h", "j", "k", "l"], "Move focus"],
  [["o"], "Next pane"],
  [[";"], "Last pane"],
  [["z"], "Zoom pane"],
  [["x"], "Close pane"],
];

const TABS = [
  [["c"], "New tab"],
  [["n", "p"], "Switch tab"],
  [["1–9", "0"], "Go to tab"],
];

const WORK = [
  [["t"], "Find work"],
  [["b"], "Agents & spaces"],
  [["J", "K"], "Switch space"],
];

function badge(t) {
  return div()
    .size(34)
    .rounded(9)
    .bg(t.selected)
    .text_color(t.accent)
    .flex()
    .items_center()
    .justify_center()
    .font_family("Geist Mono")
    .text_size(15)
    .child("⌃f");
}

function header(t) {
  return h_flex()
    .px(22)
    .py(17)
    .gap(12)
    .items_center()
    .child(badge(t))
    .child(
      v_flex()
        .gap(2)
        .child(div().font_semibold().text_size(15).child("Command layer"))
        .child(div().text_size(11).text_color(t.muted).child("One key. Pick your next move.")),
    )
    .child(div().flex_1())
    .child(div().text_size(10).text_color(t.dim).child("PREFIX KEYS"));
}

function groups(t, choose) {
  return h_flex()
    .px(22)
    .py(14)
    .gap(24)
    .border_t(1)
    .border_color(t.border)
    .child(group("PANES", PANES, t, choose).flex_1())
    .child(div().w(1).bg(t.border))
    .child(
      v_flex()
        .flex_1()
        .gap(17)
        .child(group("TABS", TABS, t, choose))
        .child(group("WORKSPACE", WORK, t, choose)),
    );
}

function sendLink(t, sendPrefix) {
  return div()
    .id("send-prefix")
    .cursor_pointer()
    .on_click(sendPrefix)
    .text_size(10.5)
    .text_color(t.muted)
    .child("ctrl f again → send prefix");
}

function footer(t, sendPrefix) {
  return h_flex()
    .px(22)
    .py(11)
    .gap(6)
    .items_center()
    .border_t(1)
    .border_color(t.border)
    .child(keycap("esc", t))
    .child(div().text_size(10.5).text_color(t.muted).child("dismiss"))
    .child(div().flex_1())
    .child(sendLink(t, sendPrefix));
}

/** Build the prefix menu with keycaps and groups for panes, tabs, and work. */
export function menu(t, choose, sendPrefix) {
  return v_flex()
    .size_full()
    .font_family("Geist")
    .bg(t.popover)
    .text_color(t.foreground)
    .child(header(t))
    .child(groups(t, choose))
    .child(footer(t, sendPrefix));
}
