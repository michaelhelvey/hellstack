// Pure helpers for the factory board. They do not use the `herdr` module, so tests can load them.

/** The task lanes in order: the task status, the heading, and the size of a card. */
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
export const EMPTY_BOARD = {
  running: null,
  tasks: [],
  inbox: [],
  invalid: 0,
  sources: [],
  feed: [],
};

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

const INBOX_FIELDS = ["id", "source", "kind", "thread", "title", "url", "ts"];

const COORDINATOR_TAB = "tbfactory";

const COORDINATOR_TERMINAL = "factory";

/**
 * The theme color name of the accent of each role: the banner and the card of the shown agent.
 */
export const ROLE_ACCENTS = {
  coordinator: "ansi5",
  worker: "ansi6",
  design: "ansi3",
  other: "dim",
};

/** The theme color name of each inbox source. Other sources use `muted`. */
export const SOURCE_ACCENTS = { github: "ansi4", sentry: "ansi1" };

/** The theme color name of each state of the subject of an inbox item. Others use `muted`. */
export const STATE_COLORS = {
  open: "done",
  unresolved: "blocked",
  merged: "ansi5",
  closed: "dim",
  resolved: "dim",
  ignored: "dim",
};

/** The theme color name of each task status. */
export const STATUS_COLORS = {
  sketch: "ansi3",
  ready: "muted",
  working: "working",
  landing: "ansi4",
  landed: "done",
};

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
  cwd: "string",
  now: "string",
  paused: "boolean",
};

const LEDGER_FILE = /\/(tasks\/[^/]+\.md|inbox\/[^/]+\.json|feed\.jsonl)$/;

/** The mod folder is `<repo>/packages/herdr/config/mods/<name>`. Returns `<repo>`. */
export function repoRoot(modFolder) {
  return modFolder.replace(/\/+$/, "").split("/").slice(0, -5).join("/");
}

/** Returns the program and the arguments that run the factory CLI with `args`. */
export function cliCommand(repo, factoryHome, args) {
  const command = ["bun", `${repo}/packages/factory/src/cli.ts`, ...args];
  return factoryHome
    ? ["env", [`FACTORY_HOME=${factoryHome}`, ...command]]
    : [command[0], command.slice(1)];
}

function oldAgent(task) {
  return task.terminal
    ? { terminal: task.terminal, role: "worker", working: Boolean(task.working) }
    : undefined;
}

/** Returns the task with `cwd` (from `repo` in old output) and `agent` (from `terminal`). */
export function normalTask(task) {
  return { ...task, cwd: task?.cwd ?? task?.repo, agent: task?.agent ?? oldAgent(task ?? {}) };
}

function validTask(task) {
  const fields = Object.entries(TASK_FIELDS).every(([key, type]) => typeof task?.[key] === type);
  return fields && [task.landing?.done, task.landing?.total].every((n) => typeof n === "number");
}

const DETAIL_FIELDS = ["author", "body", "state", "repo"];

function validDetail(detail) {
  if (detail === undefined) return true;
  const fields = DETAIL_FIELDS.map((key) => detail?.[key]);
  return (
    typeof detail === "object" && fields.every((v) => v === undefined || typeof v === "string")
  );
}

function validItem(item) {
  return validDetail(item?.detail) && INBOX_FIELDS.every((key) => typeof item?.[key] === "string");
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
  if (Array.isArray(board.tasks)) board.tasks = board.tasks.map(normalTask);
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
 * Splits the tasks into "needs you" and the lanes of {@link GROUPS}. A task with `needs_you`
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
 * thread has its key, its newest event, the count and the ids of its events, and the older
 * events.
 */
export function inboxThreads(inbox) {
  const threads = new Map();
  for (const item of inbox) {
    const thread = threads.get(item.thread);
    if (thread) thread.older.push(item);
    else threads.set(item.thread, { key: item.thread, latest: item, older: [] });
  }
  return [...threads.values()].map((thread) => ({
    ...thread,
    count: thread.older.length + 1,
    ids: [thread.latest, ...thread.older].map((item) => item.id),
  }));
}

/**
 * Returns the threads that show and the count of the threads that do not. When `open` is false,
 * only the first {@link INBOX_LIMIT} show.
 */
export function inboxPage(threads, open) {
  const shown = open ? threads : threads.slice(0, INBOX_LIMIT);
  return { shown, more: threads.length - shown.length };
}

/** Returns the threads of `source`, or all threads when `source` is empty. */
export function bySource(threads, source) {
  return source ? threads.filter((thread) => thread.latest.source === source) : threads;
}

/** Returns the count of threads of each source, in order of first use: `[["github", 8], ...]`. */
export function sourceCounts(threads) {
  const counts = new Map();
  for (const { latest } of threads) counts.set(latest.source, (counts.get(latest.source) ?? 0) + 1);
  return [...counts.entries()];
}

/** Returns the inbox without the events in `gone` (events that a dismiss or design removed). */
export function withoutGone(inbox, gone) {
  return gone.size > 0 ? inbox.filter((item) => !gone.has(item.id)) : inbox;
}

/** Returns the short text of an event kind: `comment`, `review?`, `ci`. */
export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

/** Returns the short text of a thread key: `repo#12`, `repo`, the Sentry short id, the task id. */
export function threadLabel(thread) {
  return thread.replace(/^gh:[^/]+\//, "").replace(/^(sentry|task):([^/]*\/)?/, "");
}

/** The count of body characters that show while an inbox item is closed. */
export const EXCERPT_CHARS = 320;

/**
 * Returns the body text of an inbox item: all of it when `open`, else the first
 * {@link EXCERPT_CHARS} characters. `cut` is true when text does not show.
 */
export function excerpt(body, open) {
  const text = (body ?? "").trim();
  if (open || text.length <= EXCERPT_CHARS) return { text, cut: false };
  return { text: `${text.slice(0, EXCERPT_CHARS).trimEnd()}…`, cut: true };
}

const TASK_ID = "t-[0-9a-f]{4,8}";

const ROLE_NAMES = [
  [new RegExp(`^factory-design-(${TASK_ID})$`), "design"],
  [new RegExp(`^factory-(${TASK_ID})$`), "worker"],
  [new RegExp(`^${COORDINATOR_TAB}-design-(${TASK_ID})$`), "design"],
  [new RegExp(`^${COORDINATOR_TAB}-(${TASK_ID})$`), "worker"],
];

function idRole(name) {
  for (const [pattern, role] of ROLE_NAMES) {
    const match = pattern.exec(name);
    if (match) return { role, id: match[1] };
  }
  return null;
}

function nameRole(name) {
  return name === COORDINATOR_TERMINAL ? { role: "coordinator" } : idRole(name);
}

function tabRole(tab) {
  if (tab === COORDINATOR_TAB) return { role: "coordinator" };
  return idRole(tab ?? "") ?? { role: "other" };
}

/**
 * Returns who talks in the Herdr tab `tab`. `names` are the names of the terminals in the tab. A
 * factory terminal name wins: `factory` is the coordinator, `factory-design-<id>` the design agent
 * and `factory-<id>` the worker of task `<id>`. Else the tab id tells it: `tbfactory` is the
 * coordinator, `tbfactory-<id>` a worker. Else `{ role: "other" }`.
 */
export function shownRole(tab, names = []) {
  return names.map((name) => nameRole(name ?? "")).find(Boolean) ?? tabRole(tab);
}

/** Returns the names of the terminals in the tab `tab`, from Herdr `panes()` and `terminals()`. */
export function tabTerminalNames(tab, panes, terminals) {
  const names = new Map(terminals.map((terminal) => [terminal.address, terminal.name]));
  return panes.filter((pane) => pane.tab === tab).map((pane) => names.get(pane.terminal));
}

/**
 * Returns the part of the board that the banner uses: the tasks, the count of inbox threads, what
 * runs, and the load error (an empty string when the last load was good).
 */
export function bannerData(board, error = "") {
  const inbox = inboxThreads(board.inbox).length;
  return { tasks: board.tasks, inbox, running: board.running ?? null, error };
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
export function folderName(path) {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

/** Returns the path with `~` for the home folder `home`. */
export function tildePath(path, home) {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
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
