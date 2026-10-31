/**
 * Builds the extensions into `dist`, which pi loads (see `pi.extensions` in `package.json`).
 *
 * Usage: `bun run build`
 *
 * - `dist/<extension>/index.js` for each `src/<extension>/index.ts`, with the shared code in
 *   chunks. Pi gives the extensions its own `@earendil-works/*` and `typebox` packages, so these
 *   stay external. The `@hellstack/*` packages read files next to their source, so they also stay
 *   external.
 * - `dist/package.json` without a `type`. Pi loads extensions with jiti, which imports a `.js` file
 *   in a `"type": "module"` package natively. A native import does not use the packages of pi, but
 *   the copies in `node_modules`. Without a `type`, jiti transpiles the files and uses the packages
 *   of pi.
 * - `dist/chrome-devtools/lazy-server.mjs`, a program that Node.js runs (see
 *   `src/chrome-devtools/lazy-server.ts`).
 */
import { rm } from "node:fs/promises";
import path from "node:path";

const PACKAGE_DIR = path.resolve(import.meta.dir, "..");
const SRC = path.join(PACKAGE_DIR, "src");
const DIST = path.join(PACKAGE_DIR, "dist");

async function build(config: Bun.BuildConfig): Promise<void> {
  const result = await Bun.build(config);
  if (!result.success) throw new AggregateError(result.logs, "bun build failed");
}

const extensions = await Array.fromAsync(
  new Bun.Glob("*/index.ts").scan({ cwd: SRC, absolute: true }),
);

await rm(DIST, { recursive: true, force: true });
await build({
  entrypoints: extensions,
  root: SRC,
  outdir: DIST,
  target: "node",
  format: "esm",
  splitting: true,
  external: ["@earendil-works/*", "typebox", "@hellstack/*"],
});
await build({
  entrypoints: [path.join(SRC, "chrome-devtools/lazy-server.ts")],
  outdir: path.join(DIST, "chrome-devtools"),
  naming: "[name].mjs",
  target: "node",
  format: "esm",
});
await Bun.write(path.join(DIST, "package.json"), "{}\n");
