import { join } from "node:path";
import {
  appendJsonValues,
  configEntries,
  defineSync,
  type Layers,
  setJsonValue,
} from "@hellstack/sync";

/** The pi packages that the `t4` layer adds to `settings.json`. */
export const t4Packages = ["npm:@transport4/aig-plugin-pi"];

/**
 * The models that the `t4` layer turns on in `settings.json`. They replace the `openai-codex` models
 * in the base file.
 */
export const t4Models = ["t4/gpt-5.6-luna", "t4/gpt-5.6-sol", "t4/gpt-5.6-terra"];

function addT4(text: string): string {
  return setJsonValue(
    appendJsonValues(text, ["packages"], t4Packages),
    ["enabledModels"],
    t4Models,
  );
}

/**
 * Changes the text of `settings.json` for the layers. Pi does not load packages from the agent
 * directory, so it also adds this package to `packages`.
 */
export function piSettings(text: string, layers: Layers, packageDir: string): string {
  const layered = layers.has("t4") ? addT4(text) : text;
  return appendJsonValues(layered, ["packages"], [packageDir]);
}

/** Copies `agent/` to the pi agent directory, and installs the herdr integration. */
export default defineSync(async ({ packageDir, roots, layers }) => ({
  entries: await configEntries(join(packageDir, "agent"), roots.pi, {
    "settings.json": (text) => piSettings(text, layers, packageDir),
  }),
  integrations: [{ name: "herdr (pi)", command: ["herdr", "integration", "install", "pi"] }],
}));
