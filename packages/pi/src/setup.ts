import os from "node:os";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import deepmerge from "deepmerge";
import { Config, Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { build } from "./build.ts";

/**
 * The folders that setup syncs between, and the user that setup runs as.
 */
export class SetupEnv extends Context.Service<
  SetupEnv,
  {
    /** The hellstack pi package. Setup copies its `agent` folder and adds it to the pi packages. */
    readonly packageDir: string;
    /** The pi agent folder, usually `~/.pi/agent`. */
    readonly agentDir: string;
    /** The name of the user on this machine. Setup uses it to select a layer from `LAYERS`. */
    readonly username: string;
  }
>()("hellstack-pi/setup/SetupEnv") {
  /** Uses this package, `$PI_CODING_AGENT_DIR` or `~/.pi/agent`, and the current user. */
  static readonly layer = Layer.effect(
    SetupEnv,
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const agentDir = yield* Config.String("PI_CODING_AGENT_DIR").pipe(
        Config.orElse(() =>
          Config.String("HOME").pipe(Config.map((home) => path.join(home, ".pi", "agent"))),
        ),
      );
      return SetupEnv.of({
        packageDir: path.resolve(import.meta.dir, ".."),
        agentDir,
        username: os.userInfo().username,
      });
    }),
  );
}

/**
 * The layer file in `agent/layers` for each user. Setup appends the layer of the current user to
 * `AGENTS.md`.
 */
export const LAYERS: Readonly<Record<string, string>> = {
  michaelhelvey: "transport4.md",
  helvetici: "personal.md",
};

const decodeSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject));

const union = (local: Array<unknown>, ours: Array<unknown>) => {
  const seen = new Set(local.map((item) => JSON.stringify(item)));
  return [...local, ...ours.filter((item) => !seen.has(JSON.stringify(item)))];
};

/**
 * Syncs `AGENTS.md`, the skills, and the settings of this package to the pi agent
 * folder. Setup
 * appends the layer of the current user (see `LAYERS`) to `AGENTS.md`. The settings of this package
 * are deep merged into the existing settings: hellstack values win, and arrays are a union.
 */
export const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { packageDir, agentDir, username } = yield* SetupEnv;
  const source = (...parts: Array<string>) => path.join(packageDir, "agent", ...parts);
  const target = (...parts: Array<string>) => path.join(agentDir, ...parts);
  const readSettings = (file: string) =>
    fs.exists(file).pipe(
      Effect.flatMap((exists) => (exists ? fs.readFileString(file) : Effect.succeed("{}"))),
      Effect.flatMap(decodeSettings),
    );

  const ours = yield* readSettings(source("settings.json"));
  const local = yield* readSettings(target("settings.json"));
  const settings = deepmerge.all([local, ours, { packages: [packageDir] }], { arrayMerge: union });
  yield* fs.makeDirectory(target("skills"), { recursive: true });
  yield* fs.writeFileString(target("settings.json"), `${JSON.stringify(settings, null, 2)}\n`);

  // Pi may link AGENTS.md to another file. Remove the link so that the write does not change that file.
  yield* fs.remove(target("AGENTS.md"), { force: true });
  yield* fs.copyFile(source("AGENTS.md"), target("AGENTS.md"));
  const layer = LAYERS[username];
  if (layer !== undefined) {
    const content = yield* fs.readFileString(source("layers", layer));
    yield* fs.writeFileString(target("AGENTS.md"), `\n${content}`, { flag: "a" });
  }

  const skills = yield* fs.readDirectory(source("skills"));
  for (const skill of skills.filter((name) => !name.startsWith("."))) {
    yield* fs.remove(target("skills", skill), { recursive: true, force: true });
    yield* fs.copy(source("skills", skill), target("skills", skill));
  }
});

if (import.meta.main) {
  await build();
  setup.pipe(
    Effect.provide(SetupEnv.layer.pipe(Layer.provideMerge(BunServices.layer))),
    BunRuntime.runMain,
  );
}
