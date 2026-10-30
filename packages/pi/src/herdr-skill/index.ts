import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { skillDir } from "@hellstack/skills";

import { herdrEnv } from "../herdr-agents/herdr/client.ts";

/**
 * Adds the `herdr` skill only when pi runs in a herdr pane. The `@hellstack/skills` package does
 * not load this skill itself.
 */
export default function herdrSkill(pi: ExtensionAPI): void {
  pi.on("resources_discover", () =>
    herdrEnv() === undefined ? {} : { skillPaths: [skillDir("herdr")] },
  );
}
