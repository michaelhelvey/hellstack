import { join } from "node:path";
import {
  configEntries,
  defineSync,
  type Entry,
  type Integration,
  setJsonValue,
} from "@hellstack/sync";

import { gatewayIntegration } from "./src/gateway.ts";
import { buildMermaidModule } from "./src/mermaid/build.ts";

const herdr: Integration = {
  name: "herdr (Claude Code)",
  command: ["herdr", "integration", "install", "claude"],
};

/**
 * Makes the entries of the Mermaid mod in `modDir`. The sync bundles the hooks module, so the bundle
 * is not in the repository.
 */
async function mermaidEntries(packageDir: string, modDir: string): Promise<Entry[]> {
  const content = await buildMermaidModule();
  const module: Entry = {
    kind: "file",
    target: join(modDir, "hooks", "register.js"),
    file: { content, mode: 0o644 },
  };
  return [...(await configEntries(join(packageDir, "mods", "mermaid"), modDir)), module];
}

/**
 * Copies `config/` to the Claude Code config directory, writes the Mermaid mod, and installs the
 * herdr integration. `settings.json` loads the mod with `CLAUDE_CODE_PLUGIN_DIRS`. The `t4` layer
 * also sets up the AI gateway.
 */
export default defineSync(async ({ packageDir, roots, layers }) => {
  const modDir = join(roots.claude, "mods", "mermaid");
  const gateway = layers.has("t4") ? await gatewayIntegration(roots.home) : undefined;
  const config = await configEntries(join(packageDir, "config"), roots.claude, {
    "settings.json": (text) => setJsonValue(text, ["env", "CLAUDE_CODE_PLUGIN_DIRS"], modDir),
  });
  return {
    entries: [...config, ...(await mermaidEntries(packageDir, modDir))],
    integrations: gateway === undefined ? [herdr] : [herdr, gateway],
  };
});
