import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CHROME_DEVTOOLS_MCP_VERSION = "1.12.0";

const SERVER_COMMAND = [
  "npx",
  "-y",
  `chrome-devtools-mcp@${CHROME_DEVTOOLS_MCP_VERSION}`,
  "--autoConnect",
  "--allow-unrestricted-paths",
  "--no-usage-statistics",
  "--no-performance-crux",
];

/**
 * The built lazy server. This path is the same from `src/chrome-devtools` and from
 * `dist/chrome-devtools`, because both folders are two levels below the package folder.
 */
const LAZY_SERVER = fileURLToPath(
  new URL("../../dist/chrome-devtools/lazy-server.mjs", import.meta.url),
);

/** Returns the cache file of the lazy server for `command`. A different command gets a new file. */
export function cacheFile(command: readonly string[], env = process.env): string {
  const key = createHash("sha256").update(JSON.stringify(command)).digest("hex").slice(0, 16);
  const cacheHome = env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(cacheHome, "hellstack", `chrome-devtools-mcp-${key}.json`);
}

/**
 * Adds the `chrome-devtools` MCP server. Codemode scripts call its tools. The server always
 * connects to the Chrome session of the user (`--autoConnect`) and never starts a new browser.
 *
 * Pi starts `lazy-server.mjs`, which starts `chrome-devtools-mcp` only on the first tool call.
 */
export default function chromeDevtools(pi: ExtensionAPI): void {
  pi.registerMcpServer("chrome-devtools", {
    command: process.execPath,
    args: [LAZY_SERVER, cacheFile(SERVER_COMMAND), ...SERVER_COMMAND],
    exposure: "codemode",
    timeout: 120,
    description:
      "Control the user's own signed-in Chrome: pages, snapshots, clicks, forms, screenshots, console, network, and performance traces. Open a new page for your work and do not close the user's tabs. Most tools need a pageId from list_pages.",
  });
}
