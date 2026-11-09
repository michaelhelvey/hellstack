import path from "node:path";

/** The package folder. */
const PACKAGE_DIR = path.resolve(import.meta.dir, "..");

/** The bundle that pi loads. `pi.extensions` in `package.json` points to it. */
export const BUNDLE = path.join(PACKAGE_DIR, "dist", "index.js");

/**
 * Bundles the extension and all its dependencies into `dist/index.js`. Pi loads extensions with
 * jiti, which transpiles each module one at a time: loading `src/index.ts` and its dependency tree
 * takes seconds, and loading one bundle takes about 75 ms. The pi packages and TypeBox stay
 * external, because pi gives extensions its own copies.
 *
 * The build also writes `dist/package.json` without a `type`. jiti imports a `.js` file in a
 * `"type": "module"` package natively, and a native import resolves the pi packages to the copies
 * in `node_modules`: pi then loads a second copy of itself, which takes seconds. Without a `type`,
 * jiti transpiles the bundle and gives it the pi packages that pi already loaded.
 *
 * @example
 * ```ts
 * await build(); // then start pi
 * ```
 */
export const build = async () => {
  const result = await Bun.build({
    entrypoints: [path.join(PACKAGE_DIR, "src", "index.ts")],
    outdir: path.dirname(BUNDLE),
    target: "node",
    format: "esm",
    external: ["@earendil-works/*", "typebox"],
  });
  if (!result.success) throw new AggregateError(result.logs, "bundling the extension failed");
  await Bun.write(path.join(path.dirname(BUNDLE), "package.json"), "{}\n");
};

if (import.meta.main) await build();
