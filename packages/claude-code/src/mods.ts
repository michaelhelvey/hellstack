/**
 * Bundles the hooks module of a mod, with its dependencies, to one ES module. Claude Code loads
 * only the files of a plugin, so the module cannot import a package.
 */
export async function buildModule(entrypoint: string, name: string): Promise<Uint8Array> {
  const result = await Bun.build({ entrypoints: [entrypoint], target: "browser", format: "esm" });
  const output = result.outputs[0];
  if (!result.success || output === undefined) {
    throw new AggregateError(result.logs, `Cannot bundle the ${name} mod`);
  }
  return new Uint8Array(await output.arrayBuffer());
}
