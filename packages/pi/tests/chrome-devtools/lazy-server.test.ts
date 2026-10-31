import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { readLines } from "../e2e/harness/lines.ts";
import { PACKAGE_DIR } from "../e2e/harness/sandbox.ts";

const LAZY_SERVER = path.join(PACKAGE_DIR, "dist/chrome-devtools/lazy-server.mjs");
const FAKE_SERVER = path.join(import.meta.dir, "fake-server.ts");

const ResponseSchema = z.object({ id: z.union([z.string(), z.number()]), result: z.unknown() });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hellstack-lazy-server-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The built lazy server, started with Node.js as pi does, in front of the fake server. */
class LazyServerClient {
  readonly #proc = Bun.spawn(
    [
      "node",
      LAZY_SERVER,
      path.join(dir, "cache.json"),
      "bun",
      FAKE_SERVER,
      path.join(dir, "starts.log"),
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
  );
  readonly #waiting = new Map<string | number, (result: unknown) => void>();
  #nextId = 1;

  constructor() {
    void readLines(this.#proc.stdout, (line) => {
      const response = ResponseSchema.parse(JSON.parse(line));
      this.#waiting.get(response.id)?.(response.result);
    });
  }

  async request(method: string): Promise<unknown> {
    const id = this.#nextId++;
    const result = new Promise<unknown>((resolve) => this.#waiting.set(id, resolve));
    await this.#proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`);
    await this.#proc.stdin.flush();
    return result;
  }

  async stop(): Promise<void> {
    await this.#proc.stdin.end();
    await this.#proc.exited;
  }
}

async function startCount(): Promise<number> {
  const log = await readFile(path.join(dir, "starts.log"), "utf8").catch(() => "");
  return log.split("\n").filter(Boolean).length;
}

async function connect() {
  const server = new LazyServerClient();
  const tools = await server.request("initialize").then(() => server.request("tools/list"));
  return { server, tools };
}

test("without a cache, the lazy server starts the server at once and writes the cache", async () => {
  const { server, tools } = await connect();
  await server.stop();

  expect(tools).toEqual({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
  expect(await startCount()).toBe(1);
  expect(JSON.parse(await readFile(path.join(dir, "cache.json"), "utf8"))).toMatchObject({ tools });
});

test("with a cache, the lazy server lists the tools without the server, and starts it for a call", async () => {
  await (await connect()).server.stop();

  const { server, tools } = await connect();
  const startsBeforeCall = await startCount();
  const result = await server.request("tools/call");
  await server.stop();

  expect(tools).toEqual({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
  expect(startsBeforeCall).toBe(1);
  expect(result).toEqual({ content: [{ type: "text", text: "real answer" }] });
  expect(await startCount()).toBe(2);
});
