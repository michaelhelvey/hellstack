import { z } from "zod";

/** A small JIRA REST client. Paths are relative to the site, for example `/rest/api/3/myself`. */
export interface Jira {
  get(path: string, query?: Record<string, string>): Promise<unknown>;
  send(method: "POST" | "PUT", path: string, body: unknown): Promise<unknown>;
}

/** Makes a client that sends each request through the `scripts/api` wrapper of the jira skill. */
export function apiClient(apiScript: string): Jira {
  async function run(args: string[]): Promise<unknown> {
    const proc = Bun.spawn([apiScript, ...args], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`JIRA request failed: ${args[0]}\n${out}${err}`.trim());
    return out.trim() === "" ? null : JSON.parse(out);
  }

  return {
    get: (path, query = {}) => {
      const search = new URLSearchParams(query).toString();
      return run([search ? `${path}?${search}` : path]);
    },
    send: (method, path, body) => run([path, "-X", method, "-d", JSON.stringify(body)]),
  };
}

const StatusSchema = z.object({
  name: z.string(),
  statusCategory: z.object({ key: z.string() }),
});

const IssueTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  subtask: z.boolean(),
  hierarchyLevel: z.number(),
});

/** The fields of an issue that the KPI commands use. A search gives only the fields it asks for. */
export const IssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    status: StatusSchema.optional(),
    issuetype: IssueTypeSchema.optional(),
    project: z.object({ key: z.string() }).optional(),
    duedate: z.string().nullish(),
    assignee: z.object({ displayName: z.string() }).nullish(),
    parent: z
      .object({ key: z.string(), fields: z.object({ summary: z.string() }).optional() })
      .nullish(),
    description: z.unknown().optional(),
  }),
});

/** An issue with the fields in {@link IssueSchema}. */
export type Issue = z.infer<typeof IssueSchema>;

/** An issue type of a project. */
export type IssueType = z.infer<typeof IssueTypeSchema>;

const SearchPageSchema = z.object({
  issues: z.array(IssueSchema),
  nextPageToken: z.string().nullish(),
});

/** Finds all issues that match the JQL. Each issue has only the given fields. */
export async function search(jira: Jira, jql: string, fields: string[]): Promise<Issue[]> {
  const issues: Issue[] = [];
  let token: string | null | undefined;
  do {
    const query = { jql, fields: fields.join(","), maxResults: "100" };
    const raw = await jira.get(
      "/rest/api/3/search/jql",
      token ? { ...query, nextPageToken: token } : query,
    );
    const page = SearchPageSchema.parse(raw);
    issues.push(...page.issues);
    token = page.nextPageToken;
  } while (token);
  return issues;
}

/** Gets one issue. */
export async function getIssue(jira: Jira, key: string): Promise<Issue> {
  return IssueSchema.parse(await jira.get(`/rest/api/3/issue/${key}`));
}

/** Gets the issue types of a project. */
export async function projectIssueTypes(jira: Jira, project: string): Promise<IssueType[]> {
  const schema = z.object({ issueTypes: z.array(IssueTypeSchema) });
  return schema.parse(await jira.get(`/rest/api/3/project/${project}`)).issueTypes;
}

/** Gets the account ID of the user that sends the requests. */
export async function myAccountId(jira: Jira): Promise<string> {
  const schema = z.object({ accountId: z.string() });
  return schema.parse(await jira.get("/rest/api/3/myself")).accountId;
}

const TransitionsSchema = z.object({
  transitions: z.array(z.object({ id: z.string(), name: z.string(), to: StatusSchema })),
});

/**
 * Moves an issue to the first status in the given status category (`new`, `indeterminate`, or
 * `done`). Returns the name of the new status, or null if the workflow has no such transition.
 */
export async function transitionTo(
  jira: Jira,
  key: string,
  category: string,
): Promise<string | null> {
  const path = `/rest/api/3/issue/${key}/transitions`;
  const { transitions } = TransitionsSchema.parse(await jira.get(path));
  const transition = transitions.find((t) => t.to.statusCategory.key === category);
  if (!transition) return null;
  await jira.send("POST", path, { transition: { id: transition.id } });
  return transition.to.name;
}

/** Adds a plain-text comment to an issue. */
export async function addComment(jira: Jira, key: string, text: string): Promise<void> {
  const paragraphs = text.split(/\n{2,}/).map((p) => ({
    type: "paragraph",
    content: [{ type: "text", text: p }],
  }));
  const body = { type: "doc", version: 1, content: paragraphs };
  await jira.send("POST", `/rest/api/3/issue/${key}/comment`, { body });
}
