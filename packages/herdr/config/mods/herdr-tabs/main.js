// Terminals layout's draggable top bar: space picker, tabs, and window controls.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  spaces,
  panes,
  run,
  theme,
  home,
  openOverlay,
  window as win,
  settings,
  layout,
  shared,
  setShared,
} from "herdr";

import { titlePadding, findNode, rememberPane } from "./geometry.js";

function colors(t) {
  return {
    tray: t.foreground + "06",
    tab: t.foreground + "14",
    tabEdge: t.foreground + "24",
    hover: t.foreground + "09",
    edge: t.border,
    chip: t.foreground + "09",
    text: t.foreground,
    dim: t.muted,
  };
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// The pane a tab's tab speaks for: the focused one, else its agent, else the first.
function lead(all, id) {
  const mine = all.filter((p) => p.tab === id);
  return mine.find((p) => p.focused) ?? mine.find((p) => p.program?.agent) ?? mine[0];
}

function tileStatus(p, t) {
  if (!p?.status || p.status === "idle") return null;
  return t[p.status];
}

function tabIcon(t, p) {
  const dot = tileStatus(p, t);
  return div()
    .relative()
    .flex_none()
    .size(16)
    .flex()
    .items_center()
    .justify_center()
    .text_color(t.muted)
    .child(svg("mods/workspace-chrome/terminal.svg").size(15))
    .when(Boolean(dot), (el) =>
      el.child(div().absolute().top(-2).right(-3).size(5).rounded_full().bg(dot)),
    );
}

// A control in the draggable bar: the press is its own, not the window's
// (a right press there would open the system's window menu).
function own(el) {
  return el
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_down("right", (_e, cx) => cx.stop_propagation());
}

function windowButton(id, icon, command) {
  const C = colors(theme());
  return own(
    div()
      .id(id)
      .flex_none()
      .w(24)
      .h(24)
      .rounded_full()
      .flex()
      .items_center()
      .justify_center()
      .bg(C.chip)
      .text_color(C.dim)
      .cursor_pointer()
      .hover((s) => s.bg(C.edge).text_color(C.text))
      .on_click(() => run(command))
      .child(svg(`mods/terminals-bar/${icon}.svg`).size(14)),
  );
}

function iconButton(id, icon, onClick) {
  const C = colors(theme());
  return own(div())
    .id(id)
    .flex_none()
    .p(7)
    .rounded(8)
    .text_color(C.dim)
    .cursor_pointer()
    .hover((s) => s.bg(C.chip).text_color(C.text))
    .on_click(onClick)
    .child(svg(icon.includes("/") ? icon : `mods/terminals-bar/${icon}.svg`).size(17));
}

// The shared shape of the space chip and the tabs.
function pill(el) {
  return el
    .h(30)
    .pl(10)
    .pr(12)
    .gap(8)
    .items_center()
    .cursor_pointer()
    .text_size(13)
    .line_height("20px");
}

function openPicker() {
  openOverlay({ mod: "picker", kind: "popup", at: "top", offset: 40, width: 640, height: 0.8 });
}

function spaceChip(space, C) {
  return pill(own(h_flex()))
    .id("tm-space")
    .flex_none()
    .rounded_full()
    .bg(C.chip)
    .text_color(C.dim)
    .hover((s) => s.text_color(C.text))
    .on_click(openPicker)
    .child(svg("mods/terminals-bar/stack.svg").size(15))
    .child(div().max_w(160).truncate().text_color(C.text).child(space.name));
}

function tabLabel(c, where, C) {
  return h_flex()
    .min_w(0)
    .gap(6)
    .truncate()
    .child(
      div()
        .flex_none()
        .text_color(c.active ? C.text : C.dim)
        .child(c.name),
    )
    .when(Boolean(where), (el) => el.child(div().truncate().text_color(C.dim).child(where)));
}

function tabMenu(c, space) {
  openOverlay({
    mod: "menu",
    kind: "popup",
    width: 200,
    props: { tab: "tab", target: { id: c.id, space: space.id } },
  });
}

function tabItem(c, { all, space, t, C }) {
  const p = lead(all, c.id);
  return pill(own(h_flex()))
    .id(`tm-${c.id}`)
    .flex_shrink(1)
    .w(260)
    .min_w(0)
    .rounded(13)
    .border_1()
    .when(c.active, (el) => el.bg(C.tab).border_color(C.tabEdge))
    .when(!c.active, (el) => el.border_color("#00000000").hover((s) => s.bg(C.hover)))
    .on_click(() => run("tab.select", { id: c.id }))
    .on_mouse_down("right", () => tabMenu(c, space))
    .child(tabIcon(t, p))
    .child(tabLabel(c, folder(p?.cwd), C));
}

function tray(tabs, C) {
  return h_flex()
    .flex_shrink(1)
    .min_w(0)
    .h(36)
    .items_center()
    .p(3)
    .gap(3)
    .rounded(16)
    .bg(C.tray)
    .children(tabs);
}

function windowButtons(w) {
  return h_flex()
    .flex_none()
    .pl(6)
    .pr(4)
    .gap(8)
    .child(windowButton("tm-min", "win-min", "window.minimize"))
    .child(windowButton("tm-max", w.maximized ? "win-restore" : "win-max", "window.maximize"))
    .child(windowButton("tm-close", "win-close", "window.close"));
}

function bar(w) {
  return (
    h_flex()
      .size_full()
      .gap(8)
      .items_center()
      // macOS: the window buttons sit here (the layout's traffic_lights).
      .pl(titlePadding(w, settings().zoom, layout()?.traffic_lights))
  );
}

/** The shipped Terminals tab bar with theme colors and native window-button clearance. */
export default class TerminalsBar extends View {
  remember() {
    const history = shared("tmux.history") ?? {};
    const next = rememberPane(
      history,
      panes().find((pane) => pane.focused),
    );
    if (next !== history) setShared("tmux.history", next);
  }

  panel(id) {
    const root = layout();
    const panel = findNode(root, "panel");
    if (!panel) return;
    const shown = !panel.hidden && findNode(root, "panel-body")?.active === id;
    if (shown) return run("layout.hide", { id: "panel" });
    run("layout.select", { stack: "panel-body", child: id });
    run("layout.show", { id: "panel" });
  }

  tools(space) {
    return [
      iconButton("tm-files", "mods/files/file.svg", () => this.panel("files")),
      iconButton("tm-changes", "mods/changes/changes.svg", () => this.panel("changes")),
      iconButton("tm-keys", "command", () => run("app.palette")),
      iconButton("tm-new", "plus", () => run("tab.new", { space: space.id })),
    ];
  }

  render() {
    const t = theme();
    const C = colors(t);
    this.remember();
    const space = spaces().find((p) => p.active);
    if (!space) return div();
    const ctx = { all: panes(), space, t, C };
    const tabs = space.tabs.map((c) => tabItem(c, ctx));
    const w = win() ?? {};
    return bar(w)
      .child(spaceChip(space, C))
      .child(tray(tabs, C))
      .child(div().flex_1())
      .children(this.tools(space))
      .when(Boolean(w.buttons), (el) => el.child(windowButtons(w)));
  }
}
