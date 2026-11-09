import { BunRuntime, BunStdio } from "@effect/platform-bun";
import { Layer, Logger } from "effect";
import { liveLayer, serverLayer } from "./index.ts";

/**
 * Runs the Jira MCP server on stdin and stdout. Logs go to stderr, because stdout is the protocol.
 *
 * @example
 * ```sh
 * bun packages/jira/src/mcp.ts
 * ```
 */
serverLayer(liveLayer).pipe(
  Layer.provide(BunStdio.layer),
  Layer.provide(Logger.layer([Logger.withConsoleError(Logger.formatLogFmt)])),
  Layer.launch,
  BunRuntime.runMain,
);
