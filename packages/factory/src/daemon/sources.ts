import type { Config, SourceConfig } from "../core/index.ts";
import { createGithubSource } from "./github.ts";
import { createSentrySource } from "./sentry.ts";
import type { Source } from "./source.ts";

/** Returns the source of `config`. A new source type adds one line here. */
export function createSource(config: SourceConfig): Source {
  return config.type === "github" ? createGithubSource() : createSentrySource(config);
}

/** Returns the key of a source in the daemon state and in the poll schedule. */
export function sourceKey(config: SourceConfig): string {
  if (config.type === "github") return "github";
  return `sentry:${config.org}:${[...config.projects].sort().join(",")}`;
}

/**
 * Returns `config` when each source has its own key. Throws when two sources have the same key,
 * because they would share a cursor and the seen events.
 */
export function checkSources(config: Config): Config {
  const keys = config.sources.map(sourceKey);
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) throw new Error(`config.json has two sources with the key ${duplicate}`);
  return config;
}
