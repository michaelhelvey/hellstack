import { join } from "node:path";
import { configEntries, defineSync, type Integration } from "@hellstack/sync";

import { gatewayIntegration } from "./src/gateway.ts";

const herdr: Integration = {
  name: "herdr (Claude Code)",
  command: ["herdr", "integration", "install", "claude"],
};

/**
 * Copies `config/` to the Claude Code config directory, and installs the herdr integration. The
 * `t4` layer also sets up the AI gateway.
 */
export default defineSync(async ({ packageDir, roots, layers }) => {
  const gateway = layers.has("t4") ? await gatewayIntegration(roots.home) : undefined;
  return {
    entries: await configEntries(join(packageDir, "config"), roots.claude),
    integrations: gateway === undefined ? [herdr] : [herdr, gateway],
  };
});
