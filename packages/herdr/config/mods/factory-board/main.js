// The factory board: "needs you", the task columns, the source health, and the feed.
// Data: `bun <repo>/packages/factory/src/cli.ts board --json`. It loads again when the ledger
// changes and every 20 s. Props (optional): { repo, factoryHome }. Without `repo`, the mod
// finds the repository through the link of its folder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, exec, home, props, run, terminals, theme, watchFolder } from "herdr";

import {
  EMPTY_BOARD,
  age,
  boardCommand,
  clock,
  parseBoard,
  progress,
  repoName,
  repoRoot,
  sections,
} from "./model.js";

const REFRESH_MS = 20000;

async function findRepo() {
  if (props()?.repo) return props().repo;
  const result = await exec("pwd", ["-P"], { cwd: `${appHome()}/mods/factory-board` });
  return repoRoot(result.stdout.trim());
}

async function readBoard(repo, factoryHome) {
  const [command, args] = boardCommand(repo, factoryHome);
  const result = await exec(command, args);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `board exited ${result.code}`);
  return parseBoard(result.stdout);
}

function heading(t, text, color) {
  return div()
    .text_size(10)
    .font_weight(600)
    .text_color(color ?? t.dim)
    .child(text);
}

function pill(text, color) {
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

function stateIcon(t, task, status) {
  if (task.paused) return pill("paused", t.muted);
  if (status === "working") {
    return svg("mods/workspace-chrome/spinner.svg").size(11).text_color(t.working).spin(900);
  }
  if (status === "blocked") return div().size(6).rounded_full().bg(t.blocked);
  return null;
}

function cardTop(t, task, status) {
  const icon = stateIcon(t, task, status);
  return h_flex()
    .gap(6)
    .items_center()
    .text_size(11)
    .text_color(t.dim)
    .child(div().flex_1().truncate().child(repoName(task.repo)))
    .child(div().flex_none().text_color(t.muted).child(progress(task)))
    .when(Boolean(icon), (el) => el.child(icon));
}

function focusable(el, t, task) {
  return el
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => run("agent.focus", { terminal: task.terminal }));
}

function card(t, task, status) {
  return v_flex()
    .id(`fb-${task.id}`)
    .gap(2)
    .px(9)
    .py(7)
    .rounded(7)
    .bg(t.foreground + "08")
    .when(task.paused, (el) => el.opacity(0.5))
    .when(Boolean(task.terminal), (el) => focusable(el, t, task))
    .child(cardTop(t, task, status))
    .child(div().truncate().text_color(t.foreground).child(task.title))
    .when(Boolean(task.now), (el) => el.child(div().truncate().text_color(t.dim).child(task.now)));
}

function question(t, task, status) {
  return card(t, task, status).child(div().text_color(t.blocked).child(task.needs_you));
}

function needsYou(t, tasks, statusOf) {
  return v_flex()
    .gap(6)
    .p(8)
    .rounded(9)
    .border_1()
    .border_color(t.blocked + "66")
    .bg(t.blocked + "14")
    .child(heading(t, `NEEDS YOU · ${tasks.length}`, t.blocked))
    .children(tasks.map((task) => question(t, task, statusOf(task))));
}

function column(t, { label, tasks }, statusOf) {
  const color = tasks.length > 0 ? t.muted : t.dim;
  return v_flex()
    .gap(5)
    .child(heading(t, `${label.toUpperCase()} · ${tasks.length}`, color))
    .children(tasks.map((task) => card(t, task, statusOf(task))));
}

function header(t, inbox) {
  return h_flex()
    .items_center()
    .gap(8)
    .child(div().flex_1().text_size(12).text_color(t.muted).child("Factory"))
    .child(pill(`inbox ${inbox}`, inbox > 0 ? t.accent : t.dim));
}

function health(t, sources, now) {
  if (sources.length === 0) return div().text_color(t.dim).child("no source has polled yet");
  return h_flex()
    .flex_wrap()
    .gap(10)
    .text_size(11)
    .children(
      sources.map((s) =>
        h_flex()
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
          ),
      ),
    );
}

function feedLine(t, item) {
  return h_flex()
    .gap(6)
    .items_start()
    .text_size(11)
    .child(div().flex_none().text_color(t.dim).child(clock(item.ts)))
    .child(div().flex_1().min_w(0).text_color(t.muted).child(item.summary));
}

function feed(t, items) {
  return v_flex()
    .gap(4)
    .child(heading(t, "FEED"))
    .children([...items].reverse().map((item) => feedLine(t, item)));
}

function liveStatus() {
  const live = new Map(terminals().map((terminal) => [terminal.address, terminal.status]));
  return (task) => live.get(task.terminal) ?? (task.working ? "working" : null);
}

/** The factory board mod. */
export default class FactoryBoard extends View {
  init(_props, cx) {
    this.board = EMPTY_BOARD;
    this.error = "";
    this.factoryHome = props()?.factoryHome ?? "";
    cx.spawn(async (cx) => this.start(cx));
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  async start(cx) {
    try {
      this.repo = await findRepo();
    } catch (error) {
      this.error = `cannot find the repository: ${error}`;
      return cx.notify();
    }
    this.refresh(cx);
    await this.watch(cx);
  }

  async watch(cx) {
    const ledger = this.factoryHome || `${home()}/.factory`;
    try {
      while (!this.closed) {
        await watchFolder(ledger);
        this.refresh(cx);
      }
    } catch (error) {
      console.log(`factory-board: no ledger watch, the timer refreshes: ${error}`);
    }
  }

  refresh(cx) {
    this.again = true;
    if (!this.repo || this.loading || this.closed) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      while (this.again) {
        this.again = false;
        await this.load();
        cx.notify();
      }
      this.loading = false;
    });
  }

  async load() {
    try {
      this.board = await readBoard(this.repo, this.factoryHome);
      this.error = "";
    } catch (error) {
      this.error = String(error?.message ?? error);
    }
  }

  async close() {
    this.closed = true;
  }

  render() {
    const t = theme();
    const { needsYou: asks, columns } = sections(this.board);
    const statusOf = liveStatus();
    return v_flex()
      .id("fb-root")
      .size_full()
      .overflow_y_scrollbar()
      .p(12)
      .gap(14)
      .text_size(12)
      .child(header(t, this.board.inbox))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(asks.length > 0, (el) => el.child(needsYou(t, asks, statusOf)))
      .children(columns.map((c) => column(t, c, statusOf)))
      .child(health(t, this.board.sources, Date.now()))
      .child(feed(t, this.board.feed));
  }
}
