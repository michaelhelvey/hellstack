import { NodeServices } from "@effect/platform-node";
import { Config, Context, Effect, Layer, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { AppList, NewSpace } from "./protocol.ts";

/** A failed `herdr-app` command. The usual cause is that the herdr-app window does not run. */
export class HerdrAppError extends Schema.TaggedError<
  HerdrAppError,
  { readonly brand: unique symbol }
>()("HerdrAppError", { message: Schema.String }) {}

/** A space in the herdr-app window. */
export type Space = (typeof AppList.Type)["spaces"][number];

/** The herdr-app window: its spaces, and a command that makes a space. */
export class HerdrApp extends Context.Service<
  HerdrApp,
  {
    /** The spaces in the window. */
    readonly spaces: Effect.Effect<ReadonlyArray<Space>, HerdrAppError>;
    /** Makes a space for the folder. It has one tab with a shell. */
    newSpace(name: string, folder: string): Effect.Effect<NewSpace, HerdrAppError>;
  }
>()("hellstack-herdr/HerdrApp") {
  /** Runs the `herdr-app` binary from `$HERDR_APP_BIN`, or `herdr-app` from the `PATH`. */
  static readonly layer = Layer.effect(
    HerdrApp,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const bin = yield* Config.String("HERDR_APP_BIN").pipe(
        Config.withDefault("herdr-app"),
        Effect.orDie,
      );

      const run = <A>(schema: Schema.Codec<A, unknown>, args: ReadonlyArray<string>) =>
        spawner.string(ChildProcess.make(bin, args)).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))),
          Effect.mapError(
            (error) => new HerdrAppError({ message: `${bin} ${args[0]}: ${error.message}` }),
          ),
        );

      return HerdrApp.of({
        spaces: Effect.map(run(AppList, ["ls"]), (list) => list.spaces),
        newSpace: (name, folder) =>
          run(NewSpace, ["do", "space.new", "--name", name, "--folder", folder]),
      });
    }),
  ).pipe(Layer.provide(NodeServices.layer));
}
