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
  default: "inbox",
  rules: [{ kind: "issue_new", action: "ignore" }],
};

const githubDefaults: SourceConfig = {
  type: "github",
  everySeconds: 60,
  default: "inbox",
  rules: [
    { kind: "review_requested", action: "wake" },
    { kind: "mention", action: "wake" },
  ],
};

describe("config", () => {
  test("every field has a default", () => {
    expect(defaultConfig()).toEqual({
      coordinator: { model: "claude-sonnet-5-5", thinking: "medium" },
      worker: { model: "claude-opus-5-5", thinking: "high" },
      summaryModel: "haiku",
      staleAfterMinutes: 120,
      closeAfterMinutes: 60,
      repoRoots: ["~/dev"],
      sources: [githubDefaults],
    });
  });

  test("a Sentry source without rules wakes the coordinator for regressions", () => {
    const config = parseConfig(JSON.stringify({ sources: [{ type: "sentry", org: "acme" }] }));
    expect(config.sources[0]?.rules).toEqual([{ kind: "issue_regression", action: "wake" }]);
  });

  test("the old actions candidate and mention-only read as inbox", () => {
    const old = {
      type: "github",
      default: "candidate",
      rules: [
        { kind: "ci", action: "mention-only" },
        { kind: "mention", action: "wake" },
      ],
    };
    const [source] = parseConfig(JSON.stringify({ sources: [old] })).sources;
    expect(source?.default).toBe("inbox");
    expect(source?.rules.map((rule) => rule.action)).toEqual(["inbox", "wake"]);
  });

  test("fills the defaults of nested fields and ignores the old Sentry fields", () => {
    const config = parseConfig(
      JSON.stringify({
        worker: { thinking: "max" },
        sources: [
          {
            type: "sentry",
            org: "acme",
            url: "https://sentry.io",
            tokenEnv: "SENTRY_AUTH_TOKEN",
            rules: [{ kind: "issue_new", action: "ignore" }],
          },
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
