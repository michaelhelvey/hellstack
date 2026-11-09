import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { Atlassian, AtlassianAuth } from "./atlassian.ts";
import { BOARD_TOOLS } from "./tools/boards.ts";
import { CONFLUENCE_TOOLS } from "./tools/confluence.ts";
import type { ToolFactory } from "./tools/define.ts";
import { ISSUE_TOOLS } from "./tools/issues.ts";
import { KPI_TOOLS } from "./tools/kpi.ts";

export { NAMESPACE } from "./tools/define.ts";

/** All Jira and Confluence tools. */
export const TOOLS: ReadonlyArray<ToolFactory> = [
  ...ISSUE_TOOLS,
  ...BOARD_TOOLS,
  ...KPI_TOOLS,
  ...CONFLUENCE_TOOLS,
];

/** The live services: `fetch`, and the credentials from the environment. */
export const liveLayer: Layer.Layer<Atlassian> = Atlassian.layer.pipe(
  Layer.provide(AtlassianAuth.layer),
  Layer.provide(FetchHttpClient.layer),
);

/**
 * Adds the Jira and Confluence tools to pi. The tools have `deferred` exposure in the `jira`
 * namespace: they cost no context until a codemode script calls them. The credentials are read
 * on the first call, so a session without them starts normally.
 */
export default function jira(pi: ExtensionAPI, layer: Layer.Layer<Atlassian> = liveLayer) {
  const runtime = ManagedRuntime.make(layer);
  for (const tool of TOOLS) pi.registerTool(tool(runtime));
}
