// The board actions: start and stop the factory, start a new sketch, open the agent of a task, and
// dismiss an inbox thread or send it to a design agent. Each action runs the factory CLI. Pure:
// tests can load it.

/** The text that shows while an action of each kind runs. */
export const BUSY_TEXT = {
  up: "starting…",
  down: "stopping…",
  sketch: "starting a design agent…",
  open: "opening…",
  dismiss: "dismissing…",
  design: "starting a design agent…",
};

const DISMISS_TEXT = {
  github: { ask: "dismiss", confirm: "mark done on GitHub" },
  sentry: { ask: "resolve", confirm: "resolve in Sentry" },
};

const ERROR_CHARS = 400;

/** Returns the button texts of a dismiss of an inbox item of `source`: `{ ask, confirm }`. */
export function dismissText(source) {
  return DISMISS_TEXT[source] ?? { ask: "dismiss", confirm: "remove from the inbox" };
}

function some(running) {
  return running.factoryd || running.coordinator ? "partial" : "stopped";
}

/**
 * Returns the power state from the board field `running`: `running` when factoryd and the
 * coordinator run, `stopped` when neither runs, `partial` when one runs, `unknown` without it.
 */
export function powerState(running) {
  if (!running) return "unknown";
  return running.factoryd && running.coordinator ? "running" : some(running);
}

/**
 * Returns the CLI arguments of each action. `sketch` makes an untitled sketch and starts its design
 * agent. `ids` are the event ids of an inbox thread, newest first. The CLI removes all events of the
 * thread, so the newest event is enough.
 */
export const COMMANDS = {
  up: () => ["up"],
  down: () => ["down"],
  sketch: () => ["design", "--json"],
  open: (id) => ["open", id, "--json"],
  dismiss: (ids) => ["inbox", "dismiss", ids[0], "--json"],
  design: (ids) => ["inbox", "design", ids[0], "--json"],
};

function noteOf(value) {
  if (typeof value?.message === "string") return value.message;
  return value?.terminal === null ? "nothing to open" : "";
}

function json(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function failure(stdout, stderr, code) {
  const error = json(stdout)?.error;
  const text = typeof error === "string" ? error : stderr.trim() || stdout.trim();
  return (text || `the factory CLI exited ${code}`).slice(0, ERROR_CHARS);
}

/**
 * Returns the result of a CLI run (`exec`): `{ ok, text }`. When the exit code is not 0, `text` is
 * the `error` of the JSON output (`{ ok: false, error }`), else the error output. Else it is the
 * `message` of the JSON output, or "nothing to open" when its `terminal` is null.
 */
export function cliResult({ code, stdout, stderr }) {
  if (code === 0) return { ok: true, text: noteOf(json(stdout)) };
  return { ok: false, text: failure(stdout, stderr, code) };
}

/**
 * Keeps the state of each running or failed action by key: `power`, `sketch`, `task:<id>`, or
 * `thread:<thread>`. A state is `{ phase, kind, text }`; `phase` is `confirm`, `busy`, `error`, or
 * `note`. `runCli(args)` runs the CLI and resolves with a {@link cliResult}.
 */
export class Actions {
  constructor(runCli) {
    this.runCli = runCli;
    this.states = new Map();
  }

  /** Returns the state of `key`, or undefined when no action shows. */
  get(key) {
    return this.states.get(key);
  }

  /** Shows the confirm step of `kind` for `key`. */
  ask(key, kind) {
    this.states.set(key, { phase: "confirm", kind, text: "" });
  }

  /** Removes the state of `key`. */
  clear(key) {
    this.states.delete(key);
  }

  /**
   * Runs the CLI with `args` for an action of `kind`. Does nothing while an action of `key` runs.
   * Resolves with true when the CLI succeeds.
   */
  async run(key, kind, args) {
    if (this.get(key)?.phase === "busy") return false;
    this.states.set(key, { phase: "busy", kind, text: BUSY_TEXT[kind] });
    const result = await this.runCli(args);
    this.finish(key, kind, result);
    return result.ok;
  }

  finish(key, kind, { ok, text }) {
    if (!ok || text) this.states.set(key, { phase: ok ? "note" : "error", kind, text });
    else this.states.delete(key);
  }
}
