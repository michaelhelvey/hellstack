import { fileURLToPath } from "node:url";
import { JIRA_SERVER } from "@michaelhelvey/hellstack-jira";
import opencodeCliConfig from "@michaelhelvey/hellstack-opencode/cli.json" with { type: "json" };
import opencodeConfig from "@michaelhelvey/hellstack-opencode/opencode.json" with { type: "json" };
import { PACKAGE_DIR as PI_PACKAGE_DIR } from "@michaelhelvey/hellstack-pi/build";
import piSettings from "@michaelhelvey/hellstack-pi/settings.json" with { type: "json" };
import type { Schema } from "effect";

/** A JSON config value. Setup deep merges it into the config file of the user. */
export type JsonObject = Schema.JsonObject;

/** A coding agent harness that setup installs the agent into. */
export interface Harness {
  readonly name: string;
  /** The user config folder of the harness. Setup writes `AGENTS.md` and `skills` here. */
  readonly dir: string;
  /** The config files in `dir`, by file name, with the values that setup deep merges into them. */
  readonly configs: Readonly<Record<string, JsonObject>>;
  /** Extra folders to install, by target name, with absolute source paths. */
  readonly directories: Readonly<Record<string, string>>;
}

/** An MCP server that a harness starts as a local process on stdin and stdout. */
export interface LocalServer {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** What the server offers, in a sentence. */
  readonly description: string;
}

/** The MCP servers of hellstack, by name. Bun at `bun` runs them. */
export const localServers = (bun: string): Readonly<Record<string, LocalServer>> => ({
  [JIRA_SERVER.name]: {
    command: bun,
    args: [JIRA_SERVER.entry],
    description: JIRA_SERVER.description,
  },
});

const mapValues = <A, B>(record: Readonly<Record<string, A>>, f: (value: A) => B) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, f(value)]));

/**
 * Pi: the hellstack pi package and its settings in `settings.json`, and the MCP servers in
 * `mcp.json`. Pi gives MCP tools `codemode` exposure, so they cost no context.
 *
 * @example
 * ```ts
 * pi("/Users/me/.pi/agent", localServers(process.execPath)).configs["mcp.json"];
 * ```
 */
export const pi = (dir: string, servers: Readonly<Record<string, LocalServer>>): Harness => ({
  name: "pi",
  dir,
  directories: {},
  configs: {
    "settings.json": { ...piSettings, packages: [...piSettings.packages, PI_PACKAGE_DIR] },
    "mcp.json": {
      mcpServers: mapValues(servers, (server) => ({
        command: server.command,
        args: [...server.args],
        description: server.description,
      })),
    },
  },
});

/**
 * OpenCode: the hellstack config and the MCP servers in `opencode.json`, and the TUI settings in
 * `cli.json`. OpenCode gives MCP tools Code Mode exposure, so they cost no context.
 *
 * @example
 * ```ts
 * opencode("/Users/me/.config/opencode", localServers(process.execPath)).configs["opencode.json"];
 * ```
 */
export const opencode = (dir: string, servers: Readonly<Record<string, LocalServer>>): Harness => ({
  name: "opencode",
  dir,
  directories: {
    agents: fileURLToPath(
      new URL("./agents", import.meta.resolve("@michaelhelvey/hellstack-opencode/opencode.json")),
    ),
  },
  configs: {
    "opencode.json": {
      ...opencodeConfig,
      mcp: {
        servers: mapValues(servers, (server) => ({
          type: "local",
          command: [server.command, ...server.args],
        })),
      },
    },
    "cli.json": opencodeCliConfig,
  },
});
