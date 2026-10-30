import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Adds the remote `sentry` MCP server. Codemode scripts call its tools. Sign in once with
 * `/mcp login sentry`.
 */
export default function sentry(pi: ExtensionAPI): void {
  pi.registerMcpServer("sentry", {
    url: "https://mcp.sentry.dev/mcp",
    exposure: "codemode",
    description:
      "Search and read Sentry issues, events, traces, releases, projects, and organizations.",
  });
}
