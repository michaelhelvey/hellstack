import { Context, Effect, FileSystem, Layer, Path, Schema, Semaphore } from "effect";
import { DashError } from "./item.ts";

const HiddenIds = Schema.fromJsonString(Schema.Array(Schema.String));

const wrap =
  (file: string) =>
  <A, E extends { readonly message: string }>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) => new DashError({ message: `${file}: ${error.message}` })),
      Effect.tapError((error) => Effect.logError("hidden store failed", error.message)),
    );

/**
 * The ids of the Sentry issues that the user hid. The ids stay in the store until the user clears
 * it.
 */
export class HiddenStore extends Context.Service<
  HiddenStore,
  {
    readonly list: Effect.Effect<ReadonlySet<string>, DashError>;
    readonly hide: (id: string) => Effect.Effect<void, DashError>;
    readonly clear: Effect.Effect<void, DashError>;
  }
>()("hellstack-dash/HiddenStore") {
  /**
   * Keeps the ids in the JSON file at `file`. A file that does not exist is an empty store. The
   * layer makes the parent folders of the file when it writes.
   *
   * @example
   * ```ts
   * const layer = HiddenStore.layerAt("/tmp/hidden.json").pipe(Layer.provide(BunServices.layer));
   * ```
   */
  static readonly layerAt = (file: string) =>
    Layer.effect(
      HiddenStore,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const read = Effect.gen(function* () {
          const exists = yield* fs.exists(file);
          const json = exists ? yield* fs.readFileString(file) : "[]";
          return new Set(yield* Schema.decodeEffect(HiddenIds)(json));
        });

        const write = (ids: ReadonlySet<string>) =>
          Effect.gen(function* () {
            yield* fs.makeDirectory(path.dirname(file), { recursive: true });
            yield* fs.writeFileString(file, yield* Schema.encodeEffect(HiddenIds)([...ids]));
          });

        const guard = wrap(file);
        const lock = yield* Semaphore.make(1);

        return HiddenStore.of({
          list: guard(read),
          hide: (id) =>
            guard(
              lock.withPermit(Effect.flatMap(read, (ids) => write(new Set([...ids, id])))),
            ).pipe(Effect.tap(() => Effect.logInfo("hid issue", id))),
          clear: guard(lock.withPermit(write(new Set()))).pipe(
            Effect.tap(() => Effect.logInfo("cleared hidden")),
          ),
        });
      }),
    );
}
