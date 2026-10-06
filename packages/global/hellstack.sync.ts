import { join } from "node:path";

import { defineSync, fileEntry, type Layers } from "@hellstack/sync";

/** The email in the base `AGENTS.md`. */
export const personalEmail = "michael.helvey1@gmail.com";

/** The email that the `t4` layer puts in `AGENTS.md`. */
export const t4Email = "michael.helvey@transport4.com";

/** Changes the text of `AGENTS.md` for the layers. */
export function agentsText(text: string, layers: Layers): string {
  if (!layers.has("t4")) return text;
  if (!text.includes(personalEmail)) throw new Error(`AGENTS.md does not contain ${personalEmail}`);
  return text.replaceAll(personalEmail, t4Email);
}

/**
 * Copies `AGENTS.md` to the global instructions file of each harness. Copies `pstack-models.md` to
 * `~/.agents`, where the pstack skills read their model choices.
 */
export default defineSync(async ({ packageDir, roots, layers }) => {
  const source = join(packageDir, "AGENTS.md");
  const targets = [
    join(roots.claude, "CLAUDE.md"),
    join(roots.opencode, "AGENTS.md"),
    join(roots.pi, "AGENTS.md"),
  ];
  const entries = targets.map((target) =>
    fileEntry(source, target, (text) => agentsText(text, layers)),
  );
  entries.push(
    fileEntry(
      join(packageDir, "pstack-models.md"),
      join(roots.home, ".agents", "pstack-models.md"),
    ),
  );
  return { entries: await Promise.all(entries) };
});
