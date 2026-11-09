import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { localServers, opencode, pi } from "../src/harness.ts";
import { setup, SetupEnv } from "../src/setup.ts";

setDefaultTimeout(60_000);

let home: string;

/** The environment of a harness that reads its config only from the sandbox home. */
const sandboxEnv = () => ({
  PATH: process.env.PATH ?? "",
  HOME: home,
  PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
  PI_OFFLINE: "1",
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  OPENCODE_PASSWORD: "sandbox",
});

const run = async (command: Array<string>) => {
  const child = Bun.spawn(command, {
    cwd: home,
    env: sandboxEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await child.exited;
  return `${stdout}${stderr}`;
};

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "hellstack-harness-"));
  const env = sandboxEnv();
  const servers = localServers(process.execPath);
  await Effect.runPromise(
    setup.pipe(
      Effect.provideService(SetupEnv, {
        sourceDir: path.resolve(import.meta.dir, ".."),
        harnesses: [
          pi(env.PI_CODING_AGENT_DIR, servers),
          opencode(path.join(env.XDG_CONFIG_HOME, "opencode"), servers),
        ],
        username: "nobody",
      }),
      Effect.provide(BunServices.layer),
    ),
  );
});

afterAll(() => rm(home, { recursive: true, force: true }));

test.skipIf(Bun.which("pi") === null)("pi connects to the jira MCP server", async () => {
  const output = await run(["pi", "mcp", "list", "--json"]);

  const jira = JSON.parse(output).servers.find((s: { name: string }) => s.name === "jira");
  expect(jira).toMatchObject({ state: "connected", exposure: "codemode" });
  expect(jira.tools).toContain("search");
});

test.skipIf(Bun.which("opencode") === null)(
  "opencode connects to the jira MCP server",
  async () => {
    const port = 40_000 + Math.floor(Math.random() * 20_000);
    const server = Bun.spawn(["opencode", "serve", "--port", String(port)], {
      cwd: home,
      env: sandboxEnv(),
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const list = () => run(["opencode", "mcp", "list", "--server", `http://127.0.0.1:${port}`]);
      const connected = async (attempts: number): Promise<string> => {
        await Bun.sleep(1_000);
        const output = await list();
        return output.includes("jira  connected") || attempts === 0
          ? output
          : connected(attempts - 1);
      };
      expect(await connected(30)).toContain("✓ jira  connected");
    } finally {
      server.kill();
      await server.exited;
    }
  },
);
