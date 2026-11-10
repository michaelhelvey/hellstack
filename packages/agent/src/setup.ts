import os from "node:os";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { build } from "@michaelhelvey/hellstack-pi/build";
import deepmerge from "deepmerge";
import { Config, Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { type Harness, localServers, opencode, pi } from "./harness.ts";

/**
 * The agent files that setup installs, the harnesses that it installs them into, and the user that
 * setup runs as.
 */
export class SetupEnv extends Context.Service<
  SetupEnv,
  {
    /** The folder with `AGENTS.md`, `layers`, and `skills`. */
    readonly sourceDir: string;
    readonly harnesses: ReadonlyArray<Harness>;
    /** The name of the user on this machine. Setup uses it to select a layer from `LAYERS`. */
    readonly username: string;
  }
>()("hellstack-agent/setup/SetupEnv") {
  /**
   * Uses this package, the current user, and the config folders of the harnesses:
   *
   * - pi: `$PI_CODING_AGENT_DIR`, or `~/.pi/agent`.
   * - OpenCode: `$OPENCODE_CONFIG_DIR`, or `opencode` in `$XDG_CONFIG_HOME` or `~/.config`.
   *
   * The harnesses start the MCP servers with the Bun that runs setup.
   */
  static readonly layer = Layer.effect(
    SetupEnv,
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = yield* Config.String("HOME");
      const configHome = yield* Config.String("XDG_CONFIG_HOME").pipe(
        Config.withDefault(path.join(home, ".config")),
      );
      const piDir = yield* Config.String("PI_CODING_AGENT_DIR").pipe(
        Config.withDefault(path.join(home, ".pi", "agent")),
      );
      const opencodeDir = yield* Config.String("OPENCODE_CONFIG_DIR").pipe(
        Config.withDefault(path.join(configHome, "opencode")),
      );
      const servers = localServers(process.execPath);
      return SetupEnv.of({
        sourceDir: path.resolve(import.meta.dir, ".."),
        harnesses: [pi(piDir, servers), opencode(opencodeDir, servers)],
        username: os.userInfo().username,
      });
    }),
  );
}

/**
 * The layer file in `layers` for each user. Setup appends the layer of the current user to
 * `AGENTS.md`.
 */
export const LAYERS: Readonly<Record<string, string>> = {
  michaelhelvey: "transport4.md",
  helvetici: "personal.md",
};

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject));

const union = (local: Array<unknown>, ours: Array<unknown>) => {
  const seen = new Set(local.map((item) => JSON.stringify(item)));
  return [...local, ...ours.filter((item) => !seen.has(JSON.stringify(item)))];
};

const installDirectory = Effect.fnUntraced(function* (source: string, target: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* fs.makeDirectory(target, { recursive: true });
  const entries = yield* fs.readDirectory(source);
  for (const entry of entries.filter((name) => !name.startsWith("."))) {
    const destination = path.join(target, entry);
    yield* fs.remove(destination, { recursive: true, force: true });
    yield* fs.copy(path.join(source, entry), destination);
  }
});

const install = Effect.fnUntraced(function* (harness: Harness, agents: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { sourceDir } = yield* SetupEnv;
  const target = (...parts: Array<string>) => path.join(harness.dir, ...parts);

  yield* fs.makeDirectory(harness.dir, { recursive: true });

  for (const [file, ours] of Object.entries(harness.configs)) {
    const exists = yield* fs.exists(target(file));
    const local = yield* decodeConfig(exists ? yield* fs.readFileString(target(file)) : "{}");
    const merged = deepmerge.all([local, ours], { arrayMerge: union });
    yield* fs.writeFileString(target(file), `${JSON.stringify(merged, null, 2)}\n`);
  }

  // A harness may link AGENTS.md to another file. Remove the link so that the write does not change that file.
  yield* fs.remove(target("AGENTS.md"), { force: true });
  yield* fs.writeFileString(target("AGENTS.md"), agents);

  const directories = { skills: path.join(sourceDir, "skills"), ...harness.directories };
  for (const [directory, source] of Object.entries(directories)) {
    yield* installDirectory(source, target(directory));
  }

  yield* Effect.logInfo("installed the agent").pipe(
    Effect.annotateLogs({ harness: harness.name, dir: harness.dir }),
  );
});

/**
 * Installs `AGENTS.md`, skills, extra folders, and config for each harness. Setup appends the layer of the
 * current user (see `LAYERS`) to `AGENTS.md`. The hellstack config is deep merged into the config
 * files of the user: hellstack values win, and arrays are a union.
 *
 * @example
 * ```sh
 * bun run setup
 * ```
 */
export const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { sourceDir, harnesses, username } = yield* SetupEnv;

  const instructions = yield* fs.readFileString(path.join(sourceDir, "AGENTS.md"));
  const layer = LAYERS[username];
  const agents =
    layer === undefined
      ? instructions
      : `${instructions}\n${yield* fs.readFileString(path.join(sourceDir, "layers", layer))}`;

  for (const harness of harnesses) yield* install(harness, agents);
});

if (import.meta.main) {
  await build();
  setup.pipe(
    Effect.provide(SetupEnv.layer.pipe(Layer.provideMerge(BunServices.layer))),
    BunRuntime.runMain,
  );
}
