// Configuration guide: https://rstack.rs/config
// Rstack is used for linting, formatting, and git hooks only. Bun runs,
// tests, and resolves all TypeScript directly -- there is no build step.
import { globSync, readFileSync } from "node:fs";
import { define } from "rstack";
import { z } from "zod";

// Skills from skills.sh and from pstack stay as close to upstream as possible, so that updates
// apply cleanly. Lint and format do not touch them.
function skillNames(file: string): string[] {
  const schema = z.object({ skills: z.record(z.string(), z.unknown()) });
  return Object.keys(schema.parse(JSON.parse(readFileSync(file, "utf8"))).skills);
}

const thirdParty = ["upstream.json", "skills-lock.json"]
  .flatMap((file) => skillNames(`packages/skills/${file}`))
  .map((name) => `packages/skills/skills/${name}/**`);

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
