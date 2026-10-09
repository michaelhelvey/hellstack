import { delimiter, join } from "node:path";
import {
  configEntries,
  defineSync,
  type Entry,
  type Integration,
  setJsonValue,
} from "@hellstack/sync";

import { gatewayIntegration } from "./src/gateway.ts";
import { buildMermaidModule } from "./src/mermaid/build.ts";
import { buildQuickQuoteModule } from "./src/quick-quote/build.ts";
import { buildSpinnerModule } from "./src/spinner/build.ts";

const herdr: Integration = {
  name: "herdr (Claude Code)",
  command: ["herdr", "integration", "install", "claude"],
};

/** One mod in `mods/`, and the function that bundles its hooks module. */
interface Mod {
  name: string;
  build: () => Promise<Uint8Array>;
}

const mods: Mod[] = [
  { name: "mermaid", build: buildMermaidModule },
  { name: "quick-quote", build: buildQuickQuoteModule },
  { name: "spinner", build: buildSpinnerModule },
];

/** Returns the folder of a mod in the Claude Code config directory. */
function modDir(claudeDir: string, mod: Mod): string {
  return join(claudeDir, "mods", mod.name);
}

/**
 * Makes the entries of one mod in `modDir`. The sync bundles the hooks module, so the bundle is not
 * in the repository.
 */
async function modEntries(packageDir: string, mod: Mod, modDir: string): Promise<Entry[]> {
  const module: Entry = {
    kind: "file",
    target: join(modDir, "hooks", "register.js"),
    file: { content: await mod.build(), mode: 0o644 },
  };
  return [...(await configEntries(join(packageDir, "mods", mod.name), modDir)), module];
}

/**
 * Copies `config/` to the Claude Code config directory, writes the mods, and installs the herdr
 * integration. `settings.json` loads the mods with `CLAUDE_CODE_PLUGIN_DIRS`. The `t4` layer also
 * sets up the AI gateway.
 */
export default defineSync(async ({ packageDir, roots, layers }) => {
  const dirs = mods.map((mod) => modDir(roots.claude, mod));
  const gateway = layers.has("t4") ? await gatewayIntegration(roots.home) : undefined;
  const config = await configEntries(join(packageDir, "config"), roots.claude, {
    "settings.json": (text) =>
      setJsonValue(text, ["env", "CLAUDE_CODE_PLUGIN_DIRS"], dirs.join(delimiter)),
  });
  const modFiles = await Promise.all(
    mods.map((mod) => modEntries(packageDir, mod, modDir(roots.claude, mod))),
  );
  return {
    entries: [...config, ...modFiles.flat()],
    integrations: gateway === undefined ? [herdr] : [herdr, gateway],
  };
});
