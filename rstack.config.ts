// Configuration guide: https://rstack.rs/config
// Rstack is used for linting, formatting, and git hooks only. Bun runs,
// tests, and resolves all TypeScript directly -- there is no build step.
import { globSync, readFileSync } from "node:fs";
import { define } from "rstack";
import { z } from "zod";

// Skills from skills.sh stay as close to upstream as possible, so that updates apply cleanly. Lint
// and format do not touch them.
const lockSchema = z.object({ skills: z.record(z.string(), z.unknown()) });

const thirdParty = Object.keys(
  lockSchema.parse(JSON.parse(readFileSync("packages/skills/skills-lock.json", "utf8"))).skills,
).map((name) => `packages/skills/skills/${name}/**`);

define.lint(({ js, ts }) => [
  { ignores: thirdParty },
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
  ignorePatterns: thirdParty,
});

define.staged({
  "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": ["rs lint --fix", "rs fmt"],
  "*.{json,jsonc,md,mdx,css,html,yml,yaml}": "rs fmt",
});
