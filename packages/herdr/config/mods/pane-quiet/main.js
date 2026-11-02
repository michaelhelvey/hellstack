// A quiet pane header: no bar, no rule, only a faint name, folder and agent
// state. The buttons appear while the pointer is on the pane.
// Props from the app: { pane, terminal }.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint
    ? svg(p.icon).size(size).flex_none().text_color(color)
    : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// Shells often put the folder in their title already.
function detail(title, where) {
  return where && !title.includes(where) && !/^[~/]/.test(title) ? where : "";
}

function agentName(program) {
  return (program?.agent || program?.shell) && program.name;
}

function programName(p) {
  return agentName(p.program) || p.title || p.program?.name || "shell";
}

function button(t, { id, icon, command, args }) {
  return div()
    .id(id)
    .p(3)
    .rounded(4)
    .text_color(t.dim)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      run(command, args);
    })
    .child(svg(`mods/pane/${icon}.svg`).size(13));
}

function buttons(t, p) {
  const pane = p.pane;
  const specs = [
    ["r", "split-right", "pane.split", { direction: "right", pane }],
    ["d", "split-down", "pane.split", { direction: "down", pane }],
    ["z", p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }],
    ["x", "close", "pane.close", { pane }],
  ];
  return specs.map(([key, icon, command, args]) =>
    button(t, { id: `qp-${key}-${pane}`, icon, command, args }),
  );
}

function blocked(t) {
  return div()
    .flex_none()
    .px(5)
    .h(16)
    .flex()
    .items_center()
    .rounded(4)
    .bg(t.blocked + "26")
    .text_size(10)
    .text_color(t.blocked)
    .child("Needs you");
}

function state(t, p) {
  if (p.status === "working") {
    return svg("mods/workspace-chrome/spinner.svg")
      .size(11)
      .flex_none()
      .text_color(t.working)
      .spin(900);
  }
  if (p.status === "blocked") return blocked(t);
  if (p.status === "done") return div().size(5).flex_none().rounded(3).bg(t.done);
  return null;
}

function label(t, p, name) {
  return div()
    .flex_none()
    .max_w(240)
    .truncate()
    .text_color(p.focused ? t.muted : t.dim)
    .child(name);
}

function where(t, name, p) {
  return div()
    .flex_1()
    .truncate()
    .text_color(t.dim)
    .child(detail(name, folder(p.cwd)));
}

function headerRow(pane) {
  return h_flex().id(`qp-${pane}`).size_full().pl(12).pr(8).gap(7).items_center().text_size(12);
}

export default class QuietPane extends View {
  init() {
    this.hovered = false;
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  render() {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = programName(p);
    const pic = icon(p.program, 13, t.dim);
    const status = state(t, p);
    return headerRow(p.pane)
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: p.pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(label(t, p, name))
      .child(where(t, name, p))
      .when(Boolean(status), (el) => el.child(status))
      .when(this.hovered, (el) => el.children(buttons(t, p)));
  }
}
