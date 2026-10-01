import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

import { parseErrorInfo } from "../shared/error-info.ts";

const execFileAsync = promisify(execFile);

/** Parameters of the `web_fetch` tool. */
export interface WebFetchParams {
  url: string;
  full?: boolean | undefined;
  selector?: string | undefined;
  wait_ms?: number | undefined;
  fail_on_http_error?: boolean | undefined;
}

/** The text for the agent, and the path of the full output if the text is truncated. */
export interface WebFetchOutput {
  text: string;
  truncated: boolean;
  fullOutputPath: string | undefined;
}

function fullFlag(params: WebFetchParams): string[] {
  return params.full ? ["--full"] : [];
}

function selectorFlag(params: WebFetchParams): string[] {
  return params.selector ? ["--selector", params.selector] : [];
}

function waitFlag(params: WebFetchParams): string[] {
  return params.wait_ms === undefined ? [] : ["--wait-ms", String(params.wait_ms)];
}

function httpErrorFlag(params: WebFetchParams): string[] {
  return params.fail_on_http_error ? ["--fail-on-http-error"] : [];
}

const FLAG_BUILDERS = [fullFlag, selectorFlag, waitFlag, httpErrorFlag];

/** Converts the tool parameters to `web-fetch` command-line arguments. */
export function buildWebFetchArgs(params: WebFetchParams): string[] {
  return [...FLAG_BUILDERS.flatMap((build) => build(params)), "--", params.url];
}

function binaryPath(envName: string, ...fallback: string[]): string {
  return process.env[envName] ?? join(homedir(), ...fallback);
}

/** The working directory and abort signal of a `web-fetch` run. */
export interface WebFetchRunOptions {
  cwd: string;
  signal: AbortSignal | undefined;
}

/** Runs the `web-fetch` binary and returns its Markdown output. */
export async function runWebFetch(
  params: WebFetchParams,
  options: WebFetchRunOptions,
): Promise<string> {
  const webFetch = binaryPath("WEB_FETCH_BIN", ".cargo", "bin", "web-fetch");
  const lightpanda = binaryPath("LIGHTPANDA_BIN", ".local", "bin", "lightpanda");

  try {
    const result = await execFileAsync(webFetch, buildWebFetchArgs(params), {
      ...options,
      env: { ...process.env, LIGHTPANDA_BIN: lightpanda },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });

    return result.stdout;
  } catch (error) {
    throw toWebFetchError(error, options.signal);
  }
}

function toWebFetchError(error: unknown, signal: AbortSignal | undefined): Error {
  if (signal?.aborted) return new Error("web-fetch was cancelled");
  const failure = parseErrorInfo(error);
  const message = (failure.stderr || failure.message || "unknown error").trim();
  const code = failure.code ? ` (${failure.code})` : "";

  return new Error(`web-fetch failed${code}: ${message}`);
}

/**
 * Truncates the page to the default output limits of pi. If the page is truncated, writes the
 * full page to a temporary file and adds a note with the path of that file.
 */
export async function formatWebFetchOutput(stdout: string): Promise<WebFetchOutput> {
  const truncation = truncateHead(stdout, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: truncation.content, truncated: false, fullOutputPath: undefined };
  }

  const directory = await mkdtemp(join(tmpdir(), "pi-web-fetch-"));
  const fullOutputPath = join(directory, "page.md");
  await writeFile(fullOutputPath, stdout, "utf8");

  const note =
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullOutputPath}]`;

  return { text: `${truncation.content}\n\n${note}`, truncated: true, fullOutputPath };
}
