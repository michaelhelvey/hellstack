// The inbox: one card for each thread, with the detail of its newest event and the triage
// buttons. "dismiss" asks first, because it marks the GitHub notification done or resolves the
// Sentry issue.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

import { dismissText } from "./actions.js";
import {
  ROLE_ACCENTS,
  SOURCE_ACCENTS,
  STATE_COLORS,
  age,
  bySource,
  excerpt,
  inboxPage,
  inboxThreads,
  kindLabel,
  openable,
  sourceCounts,
  threadLabel,
  withoutGone,
} from "./model.js";
import { actionLine, button, clickable, heading, pill, some } from "./ui.js";

/** The smallest width of an inbox card column, in px. */
export const INBOX_CARD_PX = 440;

function sourceColor(t, source) {
  return t[SOURCE_ACCENTS[source] ?? "muted"];
}

function stateTag(ctx, state) {
  return state ? pill(ctx, state, ctx.t[STATE_COLORS[state] ?? "muted"]) : false;
}

function cardTop(ctx, { latest, count }) {
  const { t, fs } = ctx;
  const detail = latest.detail ?? {};
  return h_flex()
    .gap(6)
    .items_center()
    .text_size(fs.small)
    .child(pill(ctx, kindLabel(latest.kind), sourceColor(t, latest.source)))
    .child(div().flex_none().font_weight(600).text_color(t.muted).child(threadLabel(latest.thread)))
    .children(some(stateTag(ctx, detail.state)))
    .when(Boolean(detail.author), (el) =>
      el.child(div().truncate().text_color(t.dim).child(`@${detail.author}`)),
    )
    .child(div().flex_1())
    .when(count > 1, (el) => el.child(pill(ctx, `×${count}`, t.muted)))
    .child(div().flex_none().text_color(t.dim).child(age(latest.ts, ctx.now)));
}

function body(ctx, thread) {
  const { t, fs } = ctx;
  const open = ctx.openBodies.has(thread.key);
  const { text, cut } = excerpt(thread.latest.detail?.body, open);
  if (!text) return false;
  const toggle = div()
    .id(`fb-more-${thread.key}`)
    .text_color(t.accent)
    .cursor_pointer()
    .on_click((_e, cx) => {
      cx.stop_propagation();
      ctx.toggleBody(thread.key, cx);
    })
    .child(open ? "less" : "more");
  return v_flex()
    .gap(2)
    .text_size(fs.small)
    .text_color(t.muted)
    .child(div().child(text))
    .when(cut || open, (el) => el.child(toggle));
}

function older(ctx, thread) {
  if (thread.older.length === 0) return false;
  const kinds = thread.older.map((item) => kindLabel(item.kind));
  return div()
    .text_size(ctx.fs.tiny)
    .text_color(ctx.t.dim)
    .child(`also ${kinds.join(", ")}`);
}

const DESIGN_TIP = "make a sketch task and start a design agent for it";

function threadButton(ctx, thread, spec) {
  return button(ctx, { ...spec, id: `fb-${spec.id}-${thread.key}` });
}

function triage(ctx, thread) {
  const { t } = ctx;
  const { ask } = dismissText(thread.latest.source);
  return [
    threadButton(ctx, thread, {
      id: "design",
      text: "design →",
      color: t[ROLE_ACCENTS.design],
      tooltip: DESIGN_TIP,
      onClick: (_e, cx) => ctx.inboxAction(thread, "design", cx),
    }),
    threadButton(ctx, thread, {
      id: "dismiss",
      text: ask,
      color: t.muted,
      onClick: (_e, cx) => ctx.ask(`thread:${thread.key}`, "dismiss", cx),
    }),
  ];
}

function confirm(ctx, thread) {
  const { t } = ctx;
  const more = thread.count > 1 ? ` (${thread.count} events)` : "";
  return [
    threadButton(ctx, thread, {
      id: "yes",
      text: dismissText(thread.latest.source).confirm + more,
      color: t.blocked,
      solid: true,
      onClick: (_e, cx) => ctx.inboxAction(thread, "dismiss", cx),
    }),
    threadButton(ctx, thread, {
      id: "no",
      text: "cancel",
      color: t.muted,
      onClick: (_e, cx) => ctx.clear(`thread:${thread.key}`, cx),
    }),
  ];
}

function buttons(ctx, thread, state) {
  if (state?.phase === "busy") return actionLine(ctx, state);
  const row = state?.phase === "confirm" ? confirm(ctx, thread) : triage(ctx, thread);
  return h_flex().flex_wrap().gap(6).items_center().children(row);
}

function cardFrame(ctx, thread) {
  const { t } = ctx;
  return v_flex()
    .id(`fb-in-${thread.key}`)
    .gap(6)
    .pl(12)
    .pr(10)
    .py(9)
    .rounded(8)
    .bg(t.foreground + "08")
    .border_l_2()
    .border_color(sourceColor(t, thread.latest.source));
}

function card(ctx, thread) {
  const { t } = ctx;
  const { latest } = thread;
  const state = ctx.actions.get(`thread:${thread.key}`);
  const title = div().text_size(ctx.fs.big).font_weight(600).text_color(t.foreground);
  const el = cardFrame(ctx, thread)
    .child(cardTop(ctx, thread))
    .child(title.child(latest.title))
    .children(some(body(ctx, thread)))
    .children(some(older(ctx, thread)))
    .child(buttons(ctx, thread, state))
    .children(some(state?.phase === "error" && actionLine(ctx, state)));
  if (!openable(latest.url)) return el;
  return clickable(el, t, (_e, cx) => cx.open_url(latest.url)).tooltip(latest.url);
}

function filterChip(ctx, [source, count], active) {
  const { t } = ctx;
  const color = source ? sourceColor(t, source) : t.foreground;
  return div()
    .id(`fb-filter-${source || "all"}`)
    .px(7)
    .py(1)
    .rounded(10)
    .text_size(ctx.fs.tiny)
    .cursor_pointer()
    .when(active, (el) => el.bg(color + "2e").text_color(color))
    .when(!active, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover)))
    .on_click((_e, cx) => ctx.setFilter(source, cx))
    .child(`${source || "all"} ${count}`);
}

function inboxHeader(ctx, threads, events) {
  const { t } = ctx;
  const chips = [["", threads.length], ...sourceCounts(threads)];
  const title = events > threads.length ? `${threads.length} · ${events} events` : threads.length;
  return h_flex()
    .gap(6)
    .items_center()
    .child(heading(ctx, `Inbox · ${title}`, threads.length > 0 ? t.muted : t.dim))
    .child(div().flex_1())
    .children(chips.map((chip) => filterChip(ctx, chip, chip[0] === ctx.filter)));
}

function columns(ctx, shown, width) {
  const count = Math.max(1, Math.min(shown.length, Math.floor(width / INBOX_CARD_PX)));
  const lists = Array.from({ length: count }, (_, i) => shown.filter((_t, n) => n % count === i));
  return h_flex()
    .items_start()
    .gap(10)
    .children(
      lists.map((list) =>
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(8)
          .children(list.map((thread) => card(ctx, thread))),
      ),
    );
}

function moreToggle(ctx, more) {
  return clickable(
    div().id("fb-in-more").px(6).py(3).rounded(5).text_color(ctx.t.dim),
    ctx.t,
    (_e, cx) => ctx.toggleInbox(cx),
  ).child(more > 0 ? `+${more} more` : "show less");
}

/**
 * Returns the inbox of `board`, `width` px wide. The cards go in as many columns as fit
 * {@link INBOX_CARD_PX}.
 */
export function inboxColumn(ctx, board, width) {
  const inbox = withoutGone(board.inbox, ctx.gone);
  const threads = inboxThreads(inbox);
  const { shown, more } = inboxPage(bySource(threads, ctx.filter), ctx.inboxOpen);
  return v_flex()
    .gap(10)
    .child(inboxHeader(ctx, threads, inbox.length))
    .when(shown.length === 0, (el) =>
      el.child(div().text_color(ctx.t.dim).child("nothing to triage")),
    )
    .child(columns(ctx, shown, width))
    .when(more > 0 || ctx.inboxOpen, (el) => el.child(moreToggle(ctx, more)));
}
