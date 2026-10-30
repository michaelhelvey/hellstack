import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CHROME_DEVTOOLS_MCP_VERSION = "1.12.0";

/**
 * Adds the `chrome-devtools` MCP server. Codemode scripts call its tools. The server always
 * connects to the Chrome session of the user (`--autoConnect`) and never starts a new browser.
 */
export default function chromeDevtools(pi: ExtensionAPI): void {
  pi.registerMcpServer("chrome-devtools", {
    command: "npx",
    args: [
      "-y",
      `chrome-devtools-mcp@${CHROME_DEVTOOLS_MCP_VERSION}`,
      "--autoConnect",
      "--allow-unrestricted-paths",
      "--no-usage-statistics",
      "--no-performance-crux",
    ],
    exposure: "codemode",
    timeout: 120,
    description:
      "Control the user's own signed-in Chrome: pages, snapshots, clicks, forms, screenshots, console, network, and performance traces. Open a new page for your work and do not close the user's tabs. Most tools need a pageId from list_pages.",
  });
}
