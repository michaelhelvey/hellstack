import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { TOOLS } from "@michaelhelvey/hellstack-jira";
import { PiSandbox } from "./pi.ts";

setDefaultTimeout(30_000);

const issue = (key: string, status: string) => ({
  key,
  fields: { summary: key, status: { name: status, statusCategory: { key: "new" } } },
});

let sandbox: PiSandbox;
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

beforeEach(async () => {
  requests.length = 0;
  sandbox = await PiSandbox.create({ defaultTools: ["+codemode"] });
});

afterEach(() => sandbox.dispose());

const env = {
  JIRA_API_TOKEN: "token",
  JIRA_USER_EMAIL: "me@example.com",
  JIRA_BASE_URL: `http://127.0.0.1:${atlassian.port}`,
};

const runScript = async (code: string) => {
  sandbox.model.callTools({ name: "codemode", arguments: { code } });
  const results = await sandbox.rpc(env).prompt("use jira");
  const result = results.find((r) => r.toolName === "codemode");
  if (!result) throw new Error("codemode did not run");
  return result;
};

test("codemode scripts call the jira tools, but the model does not see them", async () => {
  const result = await runScript(`
    const ns = await describeNamespace("jira");
    const found = await tools.jira_search({ jql: "project = PT" });
    return { tools: ns.tools.length, keys: found.issues.map((i) => i.key), hidden: found.hiddenCount };
  `);

  expect(result.isError).toBe(false);
  expect(JSON.parse(result.text.slice(result.text.indexOf("{")))).toEqual({
    tools: TOOLS.length,
    keys: ["PT-1"],
    hidden: 1,
  });
  expect(requests).toEqual([`GET /rest/api/3/search/jql Basic ${btoa("me@example.com:token")}`]);
  const declared = JSON.stringify(sandbox.model.requests[0]?.["tools"] ?? []);
  expect(declared).toContain("codemode");
  expect(declared).not.toContain('"jira_search"');
});

test("a failed request gives the script an error with the HTTP status", async () => {
  const result = await runScript(`return await tools.jira_issue({ key: "PT-404" });`);

  expect(result.isError).toBe(true);
  expect(result.text).toContain("GET /rest/api/3/issue/PT-404 failed with HTTP 404");
});
