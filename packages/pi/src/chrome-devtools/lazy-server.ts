/**
 * A stdio MCP server that starts a different stdio MCP server only when a client needs it.
 *
 * Usage: `node lazy-server.mjs <cache-file> <command> [args...]`
 *
 * Pi connects to each MCP server when a session starts. This server answers `initialize` and
 * `tools/list` from `<cache-file>`, so the session does not start `<command>`. The first other
 * request starts `<command>`, sends it the `initialize` request of the client, and then sends all
 * messages between the client and `<command>` without changes. If `<cache-file>` does not exist,
 * this server starts `<command>` at once, and writes its `initialize` and `tools/list` results to
 * `<cache-file>`.
 *
 * Pi runs this file with Node.js, so it must not use Bun APIs.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

const MessageSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
});

type Message = z.infer<typeof MessageSchema>;

type MessageId = NonNullable<Message["id"]>;

const ResultSchema = z.record(z.string(), z.unknown());

const CacheSchema = z.object({ initialize: ResultSchema, tools: ResultSchema });

type Cache = z.infer<typeof CacheSchema>;

/** The cache key of the result of each method that the cache keeps. */
const CACHED_METHODS = new Map<string | undefined, keyof Cache>([
  ["initialize", "initialize"],
  ["tools/list", "tools"],
]);

/** The ID of the `initialize` request that this server sends to `<command>` for the client. */
const REPLAY_ID = "lazy-server-initialize";

function parseJson<T>(schema: z.ZodType<T>, text: string): T | undefined {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function readCache(file: string): Cache | undefined {
  try {
    return parseJson(CacheSchema, readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeCache(file: string, cache: Cache): void {
  const temporary = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify(cache));
  renameSync(temporary, file);
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Records the `initialize` and `tools/list` results of `<command>`, and writes them as the cache. */
class CacheRecorder {
  readonly #pending = new Map<MessageId, keyof Cache>();
  readonly #found: Partial<Cache> = {};

  constructor(readonly file: string) {}

  request(message: Message): void {
    const key = CACHED_METHODS.get(message.method);
    if (key !== undefined && message.id !== undefined) this.#pending.set(message.id, key);
  }

  response(message: Message): void {
    const key = this.#pending.get(message.id ?? "");
    const result = ResultSchema.safeParse(message.result);
    if (key !== undefined && result.success) this.#save(key, result.data);
  }

  #save(key: keyof Cache, result: Cache[keyof Cache]): void {
    this.#found[key] = result;
    const cache = CacheSchema.safeParse(this.#found);
    if (cache.success) writeCache(this.file, cache.data);
  }
}

/** The connection to `<command>`. It keeps client messages until `ready()`. */
class Upstream {
  readonly #process: ChildProcess;
  readonly #queue: string[] = [];
  #ready = false;

  constructor(command: string, args: string[], onLine: (line: string) => void) {
    this.#process = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
    this.#process.on("exit", (code) => process.exit(code ?? 1));
    this.#process.on("error", (error) => {
      process.stderr.write(`lazy-server: cannot start ${command}: ${error.message}\n`);
      process.exit(1);
    });
    createInterface({ input: this.#process.stdout! }).on("line", onLine);
  }

  /** Sends `line` now, or after `ready()`. */
  write(line: string): void {
    if (this.#ready) this.#process.stdin!.write(`${line}\n`);
    else this.#queue.push(line);
  }

  /** Sends `message` before the kept lines, for the `initialize` handshake. */
  writeFirst(message: unknown): void {
    this.#process.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  /** Sends the kept lines, and sends each next line at once. */
  ready(): void {
    this.#ready = true;
    for (const line of this.#queue.splice(0)) this.write(line);
  }

  stop(): void {
    this.#process.kill();
  }
}

/** Answers from the cache until the client needs `<command>`, then starts it. */
class LazyServer {
  #upstream: Upstream | undefined;
  #initializeParams: unknown;

  constructor(
    readonly cache: Cache,
    readonly command: string,
    readonly args: string[],
  ) {}

  receive(line: string): void {
    if (this.#upstream !== undefined) return this.#upstream.write(line);
    const message = parseJson(MessageSchema, line);
    if (message !== undefined && this.#answer(message)) return;
    this.#upstream = this.#start();
    this.#upstream.write(line);
  }

  stop(): void {
    this.#upstream?.stop();
  }

  /** Answers `message` from the cache, and gives `false` if only `<command>` can answer it. */
  #answer(message: Message): boolean {
    if (message.id === undefined) return true;
    if (message.method === "initialize") this.#initializeParams = message.params;
    const result = this.#cachedResult(message.method);
    if (result !== undefined) writeLine(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    return result !== undefined;
  }

  #cachedResult(method: string | undefined): unknown {
    if (method === "ping") return {};
    const key = CACHED_METHODS.get(method);
    return key === undefined ? undefined : this.cache[key];
  }

  #start(): Upstream {
    const upstream = new Upstream(this.command, this.args, (line) => {
      if (parseJson(MessageSchema, line)?.id !== REPLAY_ID) return writeLine(line);
      upstream.writeFirst({ jsonrpc: "2.0", method: "notifications/initialized" });
      upstream.ready();
    });
    const params = this.#initializeParams;
    upstream.writeFirst({ jsonrpc: "2.0", id: REPLAY_ID, method: "initialize", params });
    return upstream;
  }
}

/** Starts `<command>` now, and records its results to make the cache. */
function startEager(file: string, command: string, args: string[]): void {
  const recorder = new CacheRecorder(file);
  const upstream = new Upstream(command, args, (line) => {
    const message = parseJson(MessageSchema, line);
    if (message !== undefined) recorder.response(message);
    writeLine(line);
  });
  upstream.ready();
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const message = parseJson(MessageSchema, line);
    if (message !== undefined) recorder.request(message);
    upstream.write(line);
  });
  input.on("close", () => upstream.stop());
}

function startLazy(cache: Cache, command: string, args: string[]): void {
  const server = new LazyServer(cache, command, args);
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => server.receive(line));
  input.on("close", () => {
    server.stop();
    process.exit(0);
  });
}

const [file, command, ...args] = process.argv.slice(2);
if (file === undefined || command === undefined) {
  process.stderr.write("Usage: lazy-server <cache-file> <command> [args...]\n");
  process.exit(2);
}
const cache = readCache(file);
if (cache === undefined) startEager(file, command, args);
else startLazy(cache, command, args);
