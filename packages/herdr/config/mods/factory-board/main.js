// The factory board: "needs you", the tasks, the inbox, the source health, and the feed. With the
// prop `view: "banner"`, the banner over the main area that names the coordinator or the worker.
// Data: `bun <repo>/packages/factory/src/cli.ts board --json`. It loads again when the ledger
// changes and every 20 s. The board puts the tasks in `shared()` for the banner.
// Props (optional): { view, repo, factoryHome }. Without `repo`, the mod finds the repository
// through the link of its folder. Without `factoryHome`, it uses FACTORY_HOME of the user's
// environment, else ~/.factory.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  appHome,
  exec,
  focused,
  home,
  props,
  setShared,
  shared,
  terminals,
  theme,
  watchFolder,
} from "herdr";

import { banner } from "./banner.js";
import { boardBody, pill } from "./board.js";
import {
  EMPTY_BOARD,
  bannerData,
  boardCommand,
  ledgerChanged,
  parseBoard,
  repoRoot,
  sharedKey,
  shownRole,
} from "./model.js";

const REFRESH_MS = 20000;
const TWO_COLUMNS_PX = 680;

// Runs `pwd` also when the props give the repository: in Herdr, when the first `exec` of a mod copy
// does not start in its first task before an `await`, that `exec` and all later ones never finish.
async function findRepo() {
  const repo = props()?.repo;
  const result = await exec("pwd", ["-P"], { cwd: repo ?? `${appHome()}/mods/factory-board` });
  return repo ? result.stdout.trim() : repoRoot(result.stdout.trim());
}

async function findLedger() {
  if (props()?.factoryHome) return props().factoryHome;
  const result = await exec("printenv", ["FACTORY_HOME"], { cwd: home() });
  return result.stdout.trim() || `${home()}/.factory`;
}

async function readBoard(repo, factoryHome) {
  const [command, args] = boardCommand(repo, factoryHome);
  const result = await exec(command, args, { cwd: repo });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `board exited ${result.code}`);
  return parseBoard(result.stdout);
}

function liveStatus() {
  const live = new Map(terminals().map((terminal) => [terminal.address, terminal.status]));
  return (task) => (live.has(task.terminal) ? live.get(task.terminal) : task.working && "working");
}

function header(t, { inbox, invalid }) {
  return h_flex()
    .items_center()
    .gap(8)
    .child(div().flex_1().text_size(13).font_weight(700).text_color(t.foreground).child("Factory"))
    .when(invalid > 0, (el) => el.child(pill(`${invalid} bad task files`, t.blocked)))
    .child(pill(`inbox ${inbox.length}`, inbox.length > 0 ? t.accent : t.dim));
}

/** The factory board mod. With the prop `view: "banner"`, it shows the banner instead. */
export default class FactoryBoard extends View {
  init(_props, cx) {
    this.board = EMPTY_BOARD;
    this.error = "";
    if (props()?.view === "banner") return;
    cx.spawn(async (cx) => this.start(cx));
    cx.timer.every(REFRESH_MS, (cx) => this.tick(cx));
  }

  async start(cx) {
    try {
      [this.repo, this.ledger] = await Promise.all([findRepo(), findLedger()]);
    } catch (error) {
      this.error = `cannot find the repository or the ledger: ${error}`;
      return cx.notify();
    }
    this.tick(cx);
  }

  tick(cx) {
    this.refresh(cx);
    if (this.ledger && !this.watching) cx.spawn(async (cx) => this.watch(cx));
  }

  async watch(cx) {
    this.watching = true;
    try {
      while (!this.closed) {
        if (ledgerChanged(await watchFolder(this.ledger), this.ledger)) this.refresh(cx);
      }
    } catch (error) {
      console.log(`factory-board: no ledger watch, the next tick tries again: ${error}`);
    }
    this.watching = false;
  }

  refresh(cx) {
    this.again = true;
    if (!this.repo || this.loading || this.closed) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      while (this.again) {
        this.again = false;
        await this.load();
        this.publish();
        cx.notify();
      }
      this.loading = false;
    });
  }

  async load() {
    try {
      this.board = await readBoard(this.repo, this.ledger);
      this.error = "";
    } catch (error) {
      this.error = String(error?.message ?? error);
    }
  }

  publish() {
    const data = JSON.stringify(bannerData(this.board));
    if (data === this.published) return;
    this.published = data;
    setShared(sharedKey(props()?.factoryHome), JSON.parse(data));
  }

  async close() {
    this.closed = true;
  }

  resize(width, cx) {
    const wide = width >= TWO_COLUMNS_PX;
    if (wide === this.wide) return;
    this.wide = wide;
    cx.notify();
  }

  context(t) {
    const toggleInbox = (_e, cx) => {
      this.inboxOpen = !this.inboxOpen;
      cx.notify();
    };
    const shown = shownRole(focused()?.tab).id;
    const inboxOpen = Boolean(this.inboxOpen);
    return {
      t,
      now: Date.now(),
      statusOf: liveStatus(),
      shown,
      wide: this.wide,
      inboxOpen,
      toggleInbox,
    };
  }

  render() {
    const t = theme();
    if (props()?.view === "banner") {
      const data = shared(sharedKey(props()?.factoryHome)) ?? bannerData(EMPTY_BOARD);
      return banner(t, shownRole(focused()?.tab), data);
    }
    return v_flex()
      .id("fb-root")
      .size_full()
      .overflow_y_scrollbar()
      .on_size_change((size, cx) => this.resize(size.width, cx))
      .p(14)
      .gap(16)
      .text_size(12)
      .child(header(t, this.board))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(boardBody(this.context(t), this.board));
  }
}
