import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect, Schema } from "effect";
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
  const agents = path.join(home, "custom-agents");
  await mkdir(agents);
  await writeFile(
    path.join(agents, "reviewer.md"),
    "---\ndescription: Reviews changes\nmode: primary\n---\nReview changes without editing files.\n",
  );
  const opencodeHarness = opencode(path.join(env.XDG_CONFIG_HOME, "opencode"), servers);
  await Effect.runPromise(
    setup.pipe(
      Effect.provideService(SetupEnv, {
        sourceDir: path.resolve(import.meta.dir, ".."),
        harnesses: [
          pi(env.PI_CODING_AGENT_DIR, servers),
          { ...opencodeHarness, directories: { ...opencodeHarness.directories, agents } },
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
  "opencode connects to jira, disables plan, and loads installed agents and commands",
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
      const output = await run([
        "opencode",
        "api",
        "get",
        "/api/agent",
        "--server",
        `http://127.0.0.1:${port}`,
      ]);
      const result = Schema.decodeSync(
        Schema.fromJsonString(
          Schema.Struct({
            data: Schema.Array(
              Schema.Struct({
                id: Schema.String,
                mode: Schema.String,
                hidden: Schema.Boolean,
                system: Schema.optional(Schema.String),
              }),
            ),
          }),
        ),
      )(output);
      expect(result.data.map((agent) => agent.id)).not.toContain("plan");
      expect(result.data.find((agent) => agent.id === "reviewer")).toMatchObject({
        mode: "primary",
        hidden: false,
        system: "Review changes without editing files.",
      });
      const commands = Schema.decodeSync(
        Schema.fromJsonString(
          Schema.Struct({
            data: Schema.Array(
              Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String) }),
            ),
          }),
        ),
      )(
        await run([
          "opencode",
          "api",
          "get",
          "/api/command",
          "--server",
          `http://127.0.0.1:${port}`,
        ]),
      );
      expect(commands.data.filter((command) => command.name === "review")).toEqual([
        {
          name: "review",
          description:
            "Review with the hellstack review skill [level] [--fix] [target or guidance]",
        },
      ]);
    } finally {
      server.kill();
      await server.exited;
    }
  },
);
