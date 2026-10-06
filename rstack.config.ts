// Configuration guide: https://rstack.rs/config
// Rstack is used for linting, formatting, and git hooks only. Bun runs,
// tests, and resolves all TypeScript directly -- there is no build step.
import { globSync, readFileSync } from "node:fs";
import { define } from "rstack";

import { parseLock, skillDirs } from "./packages/skills/src/lock.ts";

/**
 * Skills from skills.sh are third-party code. Do not lint or format them, so that
 * `bun run skills:update` can replace them without new errors or format changes.
 */
const vendoredSkills = skillDirs(
  parseLock(readFileSync("packages/skills/skills-lock.json", "utf8")),
).map((dir) => `packages/skills/skills/${dir}/**`);

define.lint(({ js, ts }) => [
  { ignores: vendoredSkills },
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ["./tsconfig.json", ...globSync("packages/*/tsconfig.json")] },
    },
  },
  { rules: { "func-style": ["error", "declaration"] } },
]);

define.fmt({
  singleQuote: false,
  proseWrap: "always",
  printWidth: 100,
  // pstack reads this file one line at a time, so prose wrap must not join its lines.
  ignorePatterns: [...vendoredSkills, "packages/global/pstack-models.md"],
});

define.staged({
  "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": ["rs lint --fix", "rs fmt"],
  "*.{json,jsonc,md,mdx,css,html,yml,yaml}": "rs fmt",
});
