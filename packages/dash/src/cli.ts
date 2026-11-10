import { Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { DashError } from "./item.ts";

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Stream.mkString(Stream.decodeText(stream));

/**
 * Runs a command and gives its stdout. The command fails with a `DashError` if it exits with a
 * code that is not zero. The error message contains stderr.
 *
 * @example
 * ```ts
 * const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
 * const out = yield* exec(spawner, "gh", ["api", "/user"]);
 * ```
 */
export const exec = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  command: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, DashError> =>
  Effect.gen(function* () {
    const handle = yield* spawner.spawn(ChildProcess.make(command, args));
    const [stdout, stderr, code] = yield* Effect.all(
      [text(handle.stdout), text(handle.stderr), handle.exitCode],
      { concurrency: "unbounded" },
    );
    if (code !== ChildProcessSpawner.ExitCode(0)) {
      return yield* new DashError({
        message: `${command} exited with ${code}: ${stderr.trim()}`,
      });
    }
    yield* Effect.logInfo("command done");
    return stdout;
  }).pipe(
    Effect.scoped,
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(new DashError({ message: `${command}: ${error.message}` })),
    ),
    Effect.tapError((error) => Effect.logError("command failed", error.message)),
    Effect.withLogSpan("duration"),
    Effect.annotateLogs({ command, args: args.join(" ") }),
  );

/**
 * Runs a command and decodes its stdout as JSON with `schema`.
 *
 * @example
 * ```ts
 * const user = yield* execJson(spawner, Schema.Struct({ login: Schema.String }), "gh", ["api", "/user"]);
 * ```
 */
export const execJson = <A>(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  schema: Schema.ConstraintCodec<A, unknown>,
  command: string,
  args: ReadonlyArray<string>,
): Effect.Effect<A, DashError> =>
  exec(spawner, command, args).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))),
    Effect.catchTag("SchemaError", (error) =>
      Effect.fail(new DashError({ message: `${command}: bad output: ${error.message}` })),
    ),
  );
