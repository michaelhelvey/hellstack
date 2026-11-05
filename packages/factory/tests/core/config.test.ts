import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";

import {
  defaultConfig,
  loadConfig,
  parseConfig,
  type SourceConfig,
} from "../../src/core/config.ts";
import { tempLedger } from "./helpers.ts";

const sentryDefaults: SourceConfig = {
  type: "sentry",
  everySeconds: 300,
  org: "acme",
  projects: [],
  tokenEnv: "SENTRY_AUTH_TOKEN",
  default: "candidate",
  rules: [{ kind: "issue_new", action: "ignore" }],
};

describe("config", () => {
  test("every field has a default", () => {
    expect(defaultConfig()).toEqual({
      coordinator: { model: "claude-sonnet-5-5", thinking: "medium" },
      worker: { model: "claude-opus-5-5", thinking: "high" },
      summaryModel: "claude-haiku-5-5",
      staleAfterMinutes: 120,
      sources: [{ type: "github", everySeconds: 60, default: "candidate", rules: [] }],
    });
  });

  test("fills the defaults of nested fields", () => {
    const config = parseConfig(
      JSON.stringify({
        worker: { thinking: "max" },
        sources: [
          { type: "sentry", org: "acme", rules: [{ kind: "issue_new", action: "ignore" }] },
        ],
      }),
    );
    expect(config.worker).toEqual({ model: "claude-opus-5-5", thinking: "max" });
    expect(config.sources).toEqual([sentryDefaults]);
  });

  test("names the bad field", () => {
    expect(() => parseConfig(JSON.stringify({ worker: { thinking: "lots" } }))).toThrow(
      "worker.thinking",
    );
    expect(() => parseConfig(JSON.stringify({ sources: [{ type: "sentry" }] }))).toThrow(
      "sources[0].org",
    );
    expect(() => parseConfig("{")).toThrow();
  });

  test("loadConfig returns the defaults when the file does not exist", async () => {
    const paths = await tempLedger();
    expect(await loadConfig(paths)).toEqual(defaultConfig());
    await writeFile(paths.config, JSON.stringify({ staleAfterMinutes: 5 }));
    expect((await loadConfig(paths)).staleAfterMinutes).toBe(5);
  });
});
