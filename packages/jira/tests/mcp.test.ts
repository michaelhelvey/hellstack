// oxlint-disable effecttsgo/experimental-api-usage -- the test drives the server with the Effect MCP client.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { McpClient, type McpClientError, McpProtocol } from "effect/ai";
import { ChildProcess } from "effect/process";
import { JIRA_SERVER } from "../src/index.ts";

setDefaultTimeout(30_000);

const issue = (key: string, status: string) => ({
  key,
  fields: { summary: key, status: { name: status, statusCategory: { key: "new" } } },
});

const requests: Array<string> = [];

const atlassian = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname} ${request.headers.get("authorization")}`);
    return url.pathname === "/rest/api/3/search/jql"
      ? Response.json({ issues: [issue("PT-1", "To Do"), issue("PT-2", "Accounted")] })
      : Response.json({ errorMessages: ["not found"] }, { status: 404 });
  },
});

afterAll(() => atlassian.stop());

const client = McpClient.layerStdio({
  name: "test",
  version: "1.0.0",
  protocol: McpProtocol.v2025_11_25,
  command: ChildProcess.make("bun", [JIRA_SERVER.entry], {
    env: {
      JIRA_API_TOKEN: "token",
      JIRA_USER_EMAIL: "me@example.com",
      JIRA_BASE_URL: `http://127.0.0.1:${atlassian.port}`,
    },
    extendEnv: true,
  }),
}).pipe(Layer.provide(BunServices.layer));

/** Starts the real server as a child process, and runs `use` with a connected client. */
const withServer = <A>(
  use: (mcp: McpClient.McpClient) => Effect.Effect<A, McpClientError.McpClientError>,
) =>
  Effect.runPromise(
    Effect.scoped(Effect.flatMap(Effect.service(McpClient.McpClient), use)).pipe(
      Effect.provide(client),
    ),
  );

const call = (name: string, args: Record<string, unknown>) =>
  withServer((mcp) =>
    Effect.gen(function* () {
      const tools = yield* mcp.listTools();
      const tool = tools.find((t) => t.name === name);
      if (tool === undefined) return yield* Effect.die(`no tool ${name}`);
      return yield* mcp.callTool({ tool, arguments: args });
    }),
  );

test("the server gives its instructions and the tools with their MCP hints", async () => {
  const { instructions, tools } = await withServer((mcp) =>
    Effect.map(mcp.listTools(), (tools) => ({ instructions: mcp.instructions, tools })),
  );

  expect(instructions?.split("\n")[0]).toBe(JIRA_SERVER.description);
  expect(tools.map((t) => t.name)).toContain("search");
  expect(tools.map((t) => t.name)).toContain("confluence_page");
  const hints = (name: string) => tools.find((t) => t.name === name)?.annotations;
  expect(hints("search")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  expect(hints("create_issue")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  expect(hints("kpi_update")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
});

test("a tool call sends the request with the credentials, and gives a structured result", async () => {
  requests.length = 0;

  const result = await call("search", { jql: "project = PT" });

  expect(result.isError).toBe(false);
  expect(result.structuredContent).toMatchObject({
    issues: [{ key: "PT-1", status: "To Do" }],
    hiddenCount: 1,
  });
  expect(requests).toEqual([`GET /rest/api/3/search/jql Basic ${btoa("me@example.com:token")}`]);
});

test("a failed request gives an error result with the HTTP status", async () => {
  const result = await call("issue", { key: "PT-404" });

  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain(
    "GET /rest/api/3/issue/PT-404 failed with HTTP 404",
  );
});
