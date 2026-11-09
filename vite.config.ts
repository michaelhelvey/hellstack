import { defineConfig, FileTypes } from "@michaelhelvey/vite-config";

export default await defineConfig({
  lint: {
    rules: {
      complexity: ["error", { max: 4 }],
    },
    overrides: [
      {
        files: FileTypes.JS_SOURCE,
        rules: { "no-console": "off" },
      },
    ],
  },
});
