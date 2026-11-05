import type { SourceConfig } from "../core/index.ts";
import { createGithubSource } from "./github.ts";
import { createSentrySource } from "./sentry.ts";
import type { Source } from "./source.ts";

/** Returns the source of `config`. A new source type adds one line here. */
export function createSource(config: SourceConfig): Source {
  return config.type === "github" ? createGithubSource() : createSentrySource(config);
}

/** Returns the key of a source in the daemon state and in the poll schedule. */
export function sourceKey(config: SourceConfig): string {
  return config.type === "github" ? "github" : `sentry:${config.org}`;
}
