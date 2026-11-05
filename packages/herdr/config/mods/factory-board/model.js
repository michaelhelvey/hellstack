// Pure helpers for the factory board. They do not use the `herdr` module, so tests can load them.

/** The board columns in order: the task status and the heading. */
export const COLUMNS = [
  ["sketch", "Sketch"],
  ["ready", "Ready"],
  ["working", "Working"],
  ["landing", "Landing"],
  ["landed", "Landed today"],
];

/** An empty board model, for the time before the first load. */
export const EMPTY_BOARD = { tasks: [], inbox: 0, invalid: 0, sources: [], feed: [] };

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

/**
 * Parses the output of `factory board --json`. Missing fields get the empty values. Throws when a
 * list or a task does not have the shape that the board shows.
 */
export function parseBoard(text) {
  const board = { ...EMPTY_BOARD, ...JSON.parse(text) };
  const lists = [board.tasks, board.sources, board.feed].every(Array.isArray);
  if (!lists || !board.tasks.every(validTask))
    throw new Error("the board output has an unknown shape");
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
 * Splits the tasks into "needs you" and the columns. A task with `needs_you` shows only in
 * "needs you".
 */
export function sections(board) {
  const calm = board.tasks.filter((task) => !task.needs_you);
  return {
    needsYou: board.tasks.filter((task) => task.needs_you),
    columns: COLUMNS.map(([status, label]) => ({
      status,
      label,
      tasks: calm.filter((task) => task.status === status),
    })),
  };
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
