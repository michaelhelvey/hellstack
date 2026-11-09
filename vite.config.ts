import { recommended as effectRecommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig, FileTypes } from "@michaelhelvey/vite-config";

export default await defineConfig({
  lint: {
    rules: {
      complexity: ["error", { max: 4 }],
    },
    overrides: [
      {
        files: FileTypes.JS_SOURCE,
        plugins: effectRecommended.plugins,
        rules: {
          ...effectRecommended.rules,
          "effecttsgo/unstable-api-usage": "off",
        },
      },
      {
        files: FileTypes.JS_SOURCE,
        rules: { "no-console": "off" },
      },
      {
        files: ["packages/agent/skills/**"],
        rules: { complexity: "off" },
      },
    ],
  },
});
