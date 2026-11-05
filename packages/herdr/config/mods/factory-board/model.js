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
export const EMPTY_BOARD = { tasks: [], inbox: 0, sources: [], feed: [] };

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

/** Parses the output of `factory board --json`. Missing lists become empty. */
export function parseBoard(text) {
  return { ...EMPTY_BOARD, ...JSON.parse(text) };
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
