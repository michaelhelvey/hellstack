import { createBashTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { findBlockedCommandMessage } from "./blocked-commands.ts";

/**
 * Replaces the bash tool with a version that blocks pip, poetry, and some `python -m` commands,
 * and tells the agent which uv command to use instead.
 */
export default function uv(pi: ExtensionAPI): void {
  const bashTool = createBashTool(process.cwd(), {
    spawnHook: (spawn) => {
      const message = findBlockedCommandMessage(spawn.command);

      if (message) throw new Error(message);

      return spawn;
    },
  });

  pi.registerTool(bashTool);
}
