import { join } from "node:path";

/**
 * Bundles the hooks module of the Mermaid mod, with `grok-mermaid` in it, to one ES module. Claude
 * Code loads only the files of a plugin, so the module cannot import a package.
 */
export async function buildMermaidModule(): Promise<Uint8Array> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "register.ts")],
    target: "browser",
    format: "esm",
  });
  const output = result.outputs[0];
  if (!result.success || output === undefined) {
    throw new AggregateError(result.logs, "Cannot bundle the Mermaid mod");
  }
  return new Uint8Array(await output.arrayBuffer());
}
