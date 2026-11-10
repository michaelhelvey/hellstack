/** @jsxImportSource @opentui/solid */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { render } from "@opentui/solid";
import { Config, Console, Effect, FileSystem, Layer, Logger, Path } from "effect";
import { Dashboard } from "./dashboard.ts";
import { Github } from "./github.ts";
import { HiddenStore } from "./hidden.ts";
import { DashError } from "./item.ts";
import { Sentry } from "./sentry.ts";
import { App } from "./ui/app.tsx";
import { connect } from "./ui/run.ts";

const POLL_MS = 60_000;

const dump = Effect.gen(function* () {
  const dashboard = yield* Dashboard;
  const snapshot = yield* dashboard.load;
  if (snapshot.errors.length > 0) {
    return yield* new DashError({ message: snapshot.errors.join("; ") });
  }
  return yield* Console.log(
    JSON.stringify(
      snapshot.rows.map((row) => row.item),
      null,
      2,
    ),
  );
});

const tui = Effect.gen(function* () {
  const connection = yield* connect;
  yield* Effect.logInfo("tui started");
  yield* Effect.callback<void, DashError>((resume) => {
    render(() => <App {...connection} pollMs={POLL_MS} />, {
      useMouse: true,
      exitOnCtrlC: true,
      onDestroy: () => resume(Effect.void),
    }).catch((error: unknown) =>
      resume(Effect.fail(new DashError({ message: `render failed: ${String(error)}` }))),
    );
  });
  yield* Effect.logInfo("tui stopped");
});

const MODES: Readonly<Record<string, typeof tui>> = { "": tui, "--dump": dump };

/** The hidden store and the log file in `~/.local/state/hellstack/dash`. */
const stateLayer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(yield* Config.String("HOME"), ".local", "state", "hellstack", "dash");
    yield* fs.makeDirectory(dir, { recursive: true });
    return Layer.mergeAll(
      HiddenStore.layerAt(path.join(dir, "hidden.json")),
      Logger.layer([Logger.toFile(Logger.formatLogFmt, path.join(dir, "dash.log"))]),
    );
  }),
);

const liveLayer = Dashboard.layer.pipe(
  Layer.provide(Layer.mergeAll(Github.layer, Sentry.layer)),
  Layer.provideMerge(stateLayer),
  Layer.provideMerge(BunServices.layer),
);

const program = Effect.gen(function* () {
  const args = process.argv.slice(2).join(" ");
  const mode = MODES[args];
  if (mode === undefined) {
    return yield* new DashError({
      message: `unknown arguments "${args}". usage: whatsgoingon [--dump]`,
    });
  }
  return yield* mode;
});

/**
 * Starts the dashboard. With `--dump`, prints the items as JSON and stops.
 *
 * @example
 * ```sh
 * bun whatsgoingon
 * bun whatsgoingon --dump
 * ```
 */
program.pipe(Effect.provide(liveLayer), BunRuntime.runMain);
