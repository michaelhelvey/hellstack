import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Dependencies } from "./deps.ts";
import { PADDING_LINE_OPTIONS } from "./rules.ts";

/**
 * Makes an oxlint config that enables only `@stylistic/padding-line-between-statements`.
 *
 * @param stylistic the path of the `@stylistic/eslint-plugin` entry module.
 */
export function oxlintConfig(stylistic: string) {
  return {
    plugins: [],
    categories: {
      correctness: "off",
      suspicious: "off",
      pedantic: "off",
      perf: "off",
      style: "off",
      restriction: "off",
      nursery: "off",
    },
    jsPlugins: [stylistic],
    rules: { "@stylistic/padding-line-between-statements": ["error", ...PADDING_LINE_OPTIONS] },
  };
}

/**
 * Runs `oxlint --fix` with only the padding line rule on the files.
 *
 * Oxlint writes its report to the stdout and stderr of this process.
 *
 * @param deps the paths of the installed packages.
 * @param files the paths to fix.
 * @returns the exit code of oxlint. It is 0 when no problems remain.
 */
export async function fixWhitespace(deps: Dependencies, files: string[]): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "whitespace-skill-"));

  try {
    const config = join(dir, "oxlintrc.json");

    await writeFile(config, JSON.stringify(oxlintConfig(deps.stylistic)));

    const args = ["--config", config, "--fix", "--", ...files];
    const proc = Bun.spawn([process.execPath, deps.oxlint, ...args], {
      stdio: ["ignore", "inherit", "inherit"],
    });

    return await proc.exited;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
