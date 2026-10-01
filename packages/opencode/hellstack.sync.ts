import { join } from "node:path";
import { appendJsonValues, configEntries, defineSync, type Layers } from "@hellstack/sync";

/** The server plugins that the `t4` layer adds to `opencode.jsonc`. */
export const t4Plugins = ["@transport4/aig-plugin-opencode"];

/** Changes the text of `opencode.jsonc` for the layers. */
export function opencodeConfig(text: string, layers: Layers): string {
  return layers.has("t4") ? appendJsonValues(text, ["plugins"], t4Plugins) : text;
}

/** Copies `config/` to the opencode config directory, and installs the herdr integration. */
export default defineSync(async ({ packageDir, roots, layers }) => ({
  entries: await configEntries(join(packageDir, "config"), roots.opencode, {
    "opencode.jsonc": (text) => opencodeConfig(text, layers),
  }),
  integrations: [
    { name: "herdr (opencode)", command: ["herdr", "integration", "install", "opencode"] },
  ],
}));
