// The factory board: the power switch, the tasks, the inbox with its triage buttons, the source
// health, and the feed. With the prop `view: "banner"`, the banner over the main area that names
// the coordinator, the worker, or the design agent.
// Data: `bun <repo>/packages/factory/src/cli.ts board --json`. It loads again when the ledger
// changes, after each action, and every 20 s. The board puts its data in `shared()` for the
// banner. Props (optional): { view, repo, factoryHome, boardFile }. Without `repo`, the mod finds
// the repository through the link of its folder. Without `factoryHome`, it uses FACTORY_HOME of
// the user's environment, else ~/.factory. With `boardFile` (for development), it reads the board
// from that JSON file and only logs the actions.

import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import {
  appHome,
  exec,
  focused,
  home,
  panes,
  props,
  readTextFile,
  setShared,
  settings,
  shared,
  terminals,
  theme,
  watchFolder,
} from "herdr";

import { Actions, COMMANDS, cliResult } from "./actions.js";
import { banner } from "./banner.js";
import { BOARD_PADDING, boardBody } from "./board.js";
import {
  EMPTY_BOARD,
  bannerData,
  cliCommand,
  ledgerChanged,
  parseBoard,
  repoRoot,
  sharedKey,
  shownRole,
  tabTerminalNames,
} from "./model.js";
import { liveWorking } from "./tasks.js";
import { fontSizes } from "./ui.js";

const REFRESH_MS = 20000;

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

async function runCli(repo, factoryHome, args) {
  const [command, rest] = cliCommand(repo, factoryHome, args);
  return exec(command, rest, { cwd: repo });
}

async function readFixture(file) {
  return parseBoard((await readTextFile(file)) ?? "{}");
}

async function readBoard(repo, factoryHome) {
  if (props()?.boardFile) return readFixture(props().boardFile);
  const result = await runCli(repo, factoryHome, ["board", "--json"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `board exited ${result.code}`);
  return parseBoard(result.stdout);
}

async function devAction(args) {
  console.log(`factory-board (dev): factory ${args.join(" ")}`);
  await exec("sleep", ["1.5"]);
  return { ok: true, text: "" };
}

function shown() {
  const now = focused();
  const live = terminals();
  const own = live.find((terminal) => terminal.address === now?.terminal)?.name;
  return shownRole(now?.tab, [own, ...tabTerminalNames(now?.tab, panes(), live)]);
}

function update(cx, change) {
  change();
  cx.notify();
}

function toggle(set, key) {
  if (set.has(key)) set.delete(key);
  else set.add(key);
}

function sizes() {
  return fontSizes(Number(settings()?.ui_font_size) || 13);
}

/** The factory board mod. With the prop `view: "banner"`, it shows the banner instead. */
export default class FactoryBoard extends View {
  init(_props, cx) {
    this.board = EMPTY_BOARD;
    this.error = "";
    this.width = 0;
    this.filter = "";
    this.gone = new Set();
    this.openBodies = new Set();
    this.actions = new Actions((args) => this.cli(args));
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

  async cli(args) {
    if (props()?.boardFile) return devAction(args);
    try {
      return cliResult(await runCli(this.repo, props()?.factoryHome, args));
    } catch (error) {
      return { ok: false, text: String(error?.message ?? error) };
    }
  }

  tick(cx) {
    this.refresh(cx);
    if (this.ledger && !this.watching && !props()?.boardFile)
      cx.spawn(async (cx) => this.watch(cx));
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
    const data = JSON.stringify(bannerData(this.board, this.error));
    if (data === this.published) return;
    this.published = data;
    setShared(sharedKey(props()?.factoryHome), JSON.parse(data));
  }

  async close() {
    this.closed = true;
  }

  act(cx, { key, kind, commands, gone = [] }) {
    cx.spawn(async (cx) => {
      const done = this.actions.run(key, kind, commands);
      cx.notify();
      if (await done) for (const id of gone) this.gone.add(id);
      this.refresh(cx);
      cx.notify();
    });
  }

  handlers() {
    return {
      power: (next, cx) => this.act(cx, { key: "power", kind: next, commands: COMMANDS[next]() }),
      openTask: (id, cx) =>
        this.act(cx, { key: `task:${id}`, kind: "open", commands: COMMANDS.open(id) }),
      inboxAction: (thread, kind, cx) =>
        this.act(cx, {
          key: `thread:${thread.key}`,
          kind,
          commands: COMMANDS[kind](thread.ids),
          gone: thread.ids,
        }),
      ask: (key, kind, cx) => update(cx, () => this.actions.ask(key, kind)),
      clear: (key, cx) => update(cx, () => this.actions.clear(key)),
      toggleBody: (key, cx) => update(cx, () => toggle(this.openBodies, key)),
      setFilter: (source, cx) => update(cx, () => (this.filter = source)),
      toggleInbox: (cx) => update(cx, () => (this.inboxOpen = !this.inboxOpen)),
    };
  }

  context(t) {
    return {
      t,
      fs: sizes(),
      now: Date.now(),
      home: home(),
      error: this.error,
      shown: shown(),
      working: liveWorking(),
      actions: this.actions,
      gone: this.gone,
      openBodies: this.openBodies,
      filter: this.filter,
      inboxOpen: Boolean(this.inboxOpen),
      ...this.handlers(),
    };
  }

  resize(width, cx) {
    if (Math.abs(width - this.width) < 1) return;
    this.width = width;
    cx.notify();
  }

  render() {
    const t = theme();
    if (props()?.view === "banner") {
      const data = shared(sharedKey(props()?.factoryHome)) ?? bannerData(EMPTY_BOARD);
      return banner({ t, fs: sizes() }, shown(), data);
    }
    return v_flex()
      .id("fb-root")
      .size_full()
      .overflow_y_scrollbar()
      .on_size_change((size, cx) => this.resize(size.width, cx))
      .p(BOARD_PADDING)
      .text_size(sizes().base)
      .child(boardBody(this.context(t), this.board, this.width));
  }
}
