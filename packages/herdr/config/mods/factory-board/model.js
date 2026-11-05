// Pure helpers for the factory board. They do not use the `herdr` module, so tests can load them.

/** The task groups in order: the task status, the heading, and the size of a card. */
export const GROUPS = [
  ["working", "Working", "full"],
  ["landing", "Landing", "full"],
  ["ready", "Ready", "line"],
  ["sketch", "Sketch", "line"],
  ["landed", "Landed today", "line"],
];

/** The count of inbox threads that show before "+N more". */
export const INBOX_LIMIT = 15;

/** An empty board model, for the time before the first load. */
export const EMPTY_BOARD = { tasks: [], inbox: [], invalid: 0, sources: [], feed: [] };

const KIND_LABELS = {
  pr_comment: "comment",
  review_requested: "review?",
  review: "review",
  ci: "ci",
  mention: "mention",
  assigned: "assigned",
  security_alert: "security",
  issue_new: "new issue",
  issue_regression: "regressed",
};

const INBOX_FIELDS = ["source", "kind", "thread", "title", "url", "ts"];

const COORDINATOR_TAB = "tbfactory";

/** The theme color name of the accent of each role: the banner and the card of the shown worker. */
export const ROLE_ACCENTS = { coordinator: "ansi5", worker: "ansi6", other: "dim" };

/**
 * Returns the `shared()` key where the board puts the tasks and the inbox count for the banner. A
 * board with the `factoryHome` prop uses its own key, so two ledgers do not mix.
 */
export function sharedKey(factoryHome) {
  return factoryHome ? `factory-board:${factoryHome}` : "factory-board";
}

const TASK_FIELDS = {
  id: "string",
  title: "string",
  status: "string",
  repo: "string",
  now: "string",
  paused: "boolean",
};

const LEDGER_FILE = /\/(tasks\/[^/]+\.md|inbox\/[^/]+\.json|feed\.jsonl)$/;

/** The mod folder is `<repo>/packages/herdr/config/mods/<name>`. Returns `<repo>`. */
export function repoRoot(modFolder) {
  return modFolder.replace(/\/+$/, "").split("/").slice(0, -5).join("/");
}

/** Returns the program and the arguments that print the board model. */
export function boardCommand(repo, factoryHome) {
  const command = ["bun", `${repo}/packages/factory/src/cli.ts`, "board", "--json"];
  return factoryHome
    ? ["env", [`FACTORY_HOME=${factoryHome}`, ...command]]
    : [command[0], command.slice(1)];
}

function validTask(task) {
  const fields = Object.entries(TASK_FIELDS).every(([key, type]) => typeof task?.[key] === type);
  return fields && [task.landing?.done, task.landing?.total].every((n) => typeof n === "number");
}

function validItem(item) {
  return INBOX_FIELDS.every((key) => typeof item?.[key] === "string");
}

function validBoard(board) {
  const lists = [board.tasks, board.inbox, board.sources, board.feed].every(Array.isArray);
  return lists && board.tasks.every(validTask) && board.inbox.every(validItem);
}

/**
 * Parses the output of `factory board --json`. Missing fields get the empty values. Throws when a
 * list, a task, or an inbox event does not have the shape that the board shows.
 */
export function parseBoard(text) {
  const board = { ...EMPTY_BOARD, ...JSON.parse(text) };
  if (!validBoard(board)) throw new Error("the board output has an unknown shape");
  return board;
}

/**
 * Returns true when a batch of changed paths from `watchFolder(ledger)` can change the board: a
 * task file, an inbox file, the feed, or the ledger folder itself. Lock, temporary, and state
 * files do not count.
 */
export function ledgerChanged(paths, ledger) {
  const root = ledger.replace(/\/+$/, "");
  return paths.some((path) => LEDGER_FILE.test(path) || path.replace(/\/+$/, "").endsWith(root));
}

/**
 * Splits the tasks into "needs you" and the groups of {@link GROUPS}. A task with `needs_you`
 * shows only in "needs you".
 */
export function sections(board) {
  const calm = board.tasks.filter((task) => !task.needs_you);
  return {
    needsYou: board.tasks.filter((task) => task.needs_you),
    groups: GROUPS.map(([status, label, size]) => ({
      status,
      label,
      size,
      tasks: calm.filter((task) => task.status === status),
    })),
  };
}

/**
 * Joins the inbox events (newest first) into threads, in the order of their newest event. Each
 * thread has its newest event and the count of its events.
 */
export function inboxThreads(inbox) {
  const threads = new Map();
  for (const item of inbox) {
    const thread = threads.get(item.thread);
    if (thread) thread.count += 1;
    else threads.set(item.thread, { latest: item, count: 1 });
  }
  return [...threads.values()];
}

/**
 * Returns the threads that show and the count of the threads that do not. When `open` is false,
 * only the first {@link INBOX_LIMIT} show.
 */
export function inboxPage(threads, open) {
  const shown = open ? threads : threads.slice(0, INBOX_LIMIT);
  return { shown, more: threads.length - shown.length };
}

/** Returns the short text of an event kind: `comment`, `review?`, `ci`. */
export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

/** Returns the short text of a thread key: `repo#12`, `repo`, the Sentry short id, the task id. */
export function threadLabel(thread) {
  return thread.replace(/^gh:[^/]+\//, "").replace(/^(sentry|task):([^/]*\/)?/, "");
}

/**
 * Returns who talks in the tab `tab` (a Herdr tab id): `{ role: "coordinator" }` for `tbfactory`,
 * `{ role: "worker", id }` for `tbfactory-<id>`, else `{ role: "other" }`.
 */
export function shownRole(tab) {
  if (tab === COORDINATOR_TAB) return { role: "coordinator" };
  const prefix = `${COORDINATOR_TAB}-`;
  const id = tab?.startsWith(prefix) ? tab.slice(prefix.length) : "";
  return id ? { role: "worker", id } : { role: "other" };
}

/**
 * Returns the part of the board that the banner uses: the tasks, the count of inbox threads, and
 * the load error (an empty string when the last load was good).
 */
export function bannerData(board, error = "") {
  return { tasks: board.tasks, inbox: inboxThreads(board.inbox).length, error };
}

/** Returns the inbox count text: `6`, or `6 · 30 events` when threads have more than one event. */
export function inboxCount(inbox) {
  const threads = inboxThreads(inbox).length;
  return inbox.length > threads ? `${threads} · ${inbox.length} events` : String(threads);
}

/** Returns the counts of the coordinator summary that are not zero, in order of importance. */
export function summary({ tasks, inbox }) {
  function count(test) {
    return tasks.filter(test).length;
  }
  const counts = [
    ["waiting on you", count((task) => task.needs_you)],
    ["working", count((task) => task.status === "working")],
    ["landing", count((task) => task.status === "landing")],
    ["ready", count((task) => task.status === "ready")],
    ["in the inbox", inbox],
  ];
  return counts.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`);
}

/** Returns true when the browser can open `url`: an absolute http or https URL with a host. */
export function openable(url) {
  return /^https?:\/\/[^/\s]+/.test(url);
}

/** Returns the last folder name of a path. */
export function repoName(path) {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/** Returns the landing progress text (`2/5`) of working and landing tasks, else an empty string. */
export function progress(task) {
  const active = task.status === "working" || task.status === "landing";
  return active && task.landing.total > 0 ? `${task.landing.done}/${task.landing.total}` : "";
}

const UNITS = [
  [86400000, "d"],
  [3600000, "h"],
  [60000, "m"],
  [1000, "s"],
];

/** Returns the time since `ts` in the largest whole unit: `12s`, `3m`, `2h`, `4d`. */
export function age(ts, now) {
  const ms = Math.max(0, now - Date.parse(ts));
  const [size, unit] = UNITS.find(([size]) => ms >= size) ?? UNITS[3];
  return `${Math.floor(ms / size)}${unit}`;
}

/** Returns the local time of `ts` as `HH:MM`. */
export function clock(ts) {
  const date = new Date(ts);
  return [date.getHours(), date.getMinutes()].map((n) => String(n).padStart(2, "0")).join(":");
}
