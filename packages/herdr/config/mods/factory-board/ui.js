// Small parts that the board and the banner share: text sizes, pills, buttons, and icons.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

/** Returns the text sizes for the UI font size `base` of the user's settings. */
export function fontSizes(base) {
  return { base, small: base - 1, tiny: base - 2, big: base + 1 };
}

/** Returns `[part]`, or an empty list when `part` is false: for `.children()`. */
export function some(part) {
  return part ? [part] : [];
}

/** Returns a Herdr icon from `mods/workspace-chrome` in `color`. */
export function icon(name, size, color) {
  return svg(`mods/workspace-chrome/${name}.svg`).flex_none().size(size).text_color(color);
}

/** Returns the turning spinner that shows a working agent or a running action. */
export function spinner(color, size = 11) {
  return icon("spinner", size, color).spin(900);
}

/** Returns a round dot of `color`. */
export function dot(color, size = 7) {
  return div().flex_none().size(size).rounded_full().bg(color);
}

/** Returns a small bold heading in capitals. */
export function heading(ctx, text, color) {
  return div()
    .text_size(ctx.fs.tiny)
    .font_weight(700)
    .text_color(color ?? ctx.t.dim)
    .child(text.toUpperCase());
}

/** Returns a small label on a faint background of `color`. */
export function pill(ctx, text, color) {
  return div()
    .flex_none()
    .px(6)
    .py(1)
    .rounded(4)
    .bg(color + "24")
    .text_size(ctx.fs.tiny)
    .text_color(color)
    .child(text);
}

/** Makes `el` a hover-lit click target. */
export function clickable(el, t, onClick) {
  return el
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(onClick);
}

function look(el, t, { color, solid }) {
  if (solid)
    return el
      .bg(color)
      .text_color(t.background)
      .hover((s) => s.opacity(0.85));
  return el
    .border_1()
    .border_color(color + "66")
    .text_color(color)
    .hover((s) => s.bg(color + "24").border_color(color));
}

/**
 * Returns a button. `spec`: `{ id, text, color, solid?, tooltip?, onClick }`. A solid button has a
 * fill of `color`; else it has a border of `color`. The click does not go to the element under it.
 */
export function button(ctx, spec) {
  const el = h_flex()
    .id(spec.id)
    .flex_none()
    .gap(5)
    .items_center()
    .px(9)
    .py(3)
    .rounded(6)
    .text_size(ctx.fs.small)
    .font_weight(600)
    .cursor_pointer()
    .on_click((e, cx) => {
      cx.stop_propagation();
      spec.onClick(e, cx);
    })
    .child(spec.text);
  return look(el, ctx.t, spec).when(Boolean(spec.tooltip), (el) => el.tooltip(spec.tooltip));
}

/** Returns a line with a spinner and the text of a running action. */
export function busyLine(ctx, text) {
  return h_flex()
    .gap(6)
    .items_center()
    .text_size(ctx.fs.small)
    .text_color(ctx.t.working)
    .child(spinner(ctx.t.working))
    .child(text);
}

function closeButton(ctx, key) {
  return div()
    .id(`fb-x-${key}`)
    .flex_none()
    .px(4)
    .rounded(4)
    .text_color(ctx.t.dim)
    .cursor_pointer()
    .hover((s) => s.bg(ctx.t.hover).text_color(ctx.t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      ctx.clear(key, cx);
    })
    .child("✕");
}

function messageLine(ctx, key, state) {
  const color = state.phase === "error" ? ctx.t.blocked : ctx.t.muted;
  return h_flex()
    .gap(6)
    .items_start()
    .text_size(ctx.fs.small)
    .child(div().flex_1().min_w(0).text_color(color).child(state.text))
    .child(closeButton(ctx, key));
}

/**
 * Returns a line for the state of the action `key`: a spinner while it runs, else its error or
 * note with a button that clears it. Returns false when there is nothing to show.
 */
export function actionLine(ctx, key) {
  const state = ctx.actions.get(key);
  if (state?.phase === "busy") return busyLine(ctx, state.text);
  return ["error", "note"].includes(state?.phase) && messageLine(ctx, key, state);
}
