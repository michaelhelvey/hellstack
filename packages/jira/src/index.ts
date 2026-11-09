import path from "node:path";
import { Effect, Layer } from "effect";
import { McpProtocol, type McpSchema, McpServer, Toolkit } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { Atlassian, AtlassianAuth } from "./atlassian.ts";
import { BoardHandlers, BoardTools } from "./tools/boards.ts";
import { ConfluenceHandlers, ConfluenceTools } from "./tools/confluence.ts";
import { IssueHandlers, IssueTools } from "./tools/issues.ts";
import { KpiHandlers, KpiTools } from "./tools/kpi.ts";

/** All Jira and Confluence tools. */
export const JiraTools = Toolkit.merge(IssueTools, BoardTools, KpiTools, ConfluenceTools);

/** The live services: `fetch`, and the credentials from the environment. */
export const liveLayer: Layer.Layer<Atlassian> = Atlassian.layer.pipe(
  Layer.provide(AtlassianAuth.layer),
  Layer.provide(FetchHttpClient.layer),
);

/**
 * How a harness starts the Jira MCP server. The server speaks MCP on stdin and stdout, and reads
 * the credentials from the environment on the first tool call.
 *
 * @example
 * ```ts
 * const mcpServers = {
 *   [JIRA_SERVER.name]: { command: "bun", args: [JIRA_SERVER.entry] },
 * };
 * ```
 */
export const JIRA_SERVER = {
  name: "jira",
  entry: path.join(import.meta.dir, "mcp.ts"),
  description:
    "Jira and Confluence on Atlassian Cloud: issues, boards, sprints, time tracking, operations epics, weekly KPIs, and Confluence pages.",
} as const;

const INSTRUCTIONS = [
  JIRA_SERVER.description,
  "Call these tools from codemode scripts, and load the `jira` skill before the first call.",
  "Searches and board lists do not include Accounted and Removed issues unless `includeHidden` is true.",
  "The tools refuse to set Business Category, Operations Category, Complete Work Sprint, and CWIP fields, and refuse to move issues to Accounted.",
  "Each issue result has a `url`. Give it to the user for each issue that you create or change.",
  "Use `request` for a REST API call that no other tool does. Its path is relative to the site, for example `/rest/api/3/myself` or `/wiki/api/v2/pages/123`.",
].join("\n");

const requests = McpServer.middleware<{ provides: Atlassian }>()(
  Effect.map(
    Effect.service(Atlassian),
    (atlassian): McpServer.middleware.Fn<Atlassian, McpSchema.McpErrorBase, never> =>
      (effect, { method, target }) =>
        effect.pipe(
          Effect.provideService(Atlassian, atlassian),
          Effect.tap(() => Effect.logInfo("request done")),
          Effect.withLogSpan("duration"),
          Effect.annotateLogs({ method, target }),
        ),
  ),
);

const handlers = Layer.mergeAll(IssueHandlers, BoardHandlers, KpiHandlers, ConfluenceHandlers);

/**
 * The Jira MCP server on stdin and stdout. The tools send their requests with the `Atlassian`
 * service of `layer`. The server logs each request.
 *
 * @example
 * ```ts
 * Layer.launch(serverLayer(liveLayer).pipe(Layer.provide(BunStdio.layer)));
 * ```
 */
export const serverLayer = (layer: Layer.Layer<Atlassian>) =>
  McpServer.layerStdio({
    name: JIRA_SERVER.name,
    version: "1.0.0",
    instructions: INSTRUCTIONS,
    protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
    registrations: McpServer.toolkit(JiraTools).pipe(
      Layer.provide(handlers),
      Layer.provide(requests.layer),
      Layer.provide(layer),
    ),
  });
