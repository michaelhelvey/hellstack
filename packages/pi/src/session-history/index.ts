import { StringEnum } from "@earendil-works/pi-ai";
import {
  defineTool,
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  readTranscript,
  resolveSession,
  searchSessions,
  summarize,
  type SessionSummary,
} from "./sessions.ts";

const NAMESPACE = {
  name: "session_history",
  description:
    "Past pi sessions. Use them to find out what the user worked on before, for example to catch up on a repository.",
};

const Scope = Type.Optional(
  StringEnum(["project", "all"], {
    description:
      'Sessions to use: "project" (default) for the current directory, "all" for every directory',
  }),
);

const IncludeTools = Type.Optional(
  Type.Boolean({ description: "Include tool calls and tool results. Default: false" }),
);

const MaxChars = Type.Optional(
  Type.Integer({
    minimum: 1,
    description: "Maximum characters for the text of one item. Default: 2000",
  }),
);

const Item = Type.Object({
  entryId: Type.String(),
  timestamp: Type.String(),
  role: StringEnum(["user", "assistant", "tool", "summary"]),
  text: Type.String(),
});

const SessionSummarySchema = Type.Object({
  id: Type.String(),
  path: Type.String(),
  cwd: Type.String(),
  name: Type.Optional(Type.String()),
  created: Type.String(),
  modified: Type.String(),
  messageCount: Type.Number(),
  firstMessage: Type.String(),
  current: Type.Boolean({ description: "True for the session that makes the call" }),
});

const DEFAULT_MAX_CHARS = 2000;

async function listSessions(ctx: ExtensionContext, scope = "project"): Promise<SessionInfo[]> {
  if (scope === "all") return SessionManager.listAll();
  return SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
}

async function listSummaries(ctx: ExtensionContext, scope?: string): Promise<SessionSummary[]> {
  return summarize(await listSessions(ctx, scope), ctx.sessionManager.getSessionId());
}

function transcriptOptions(params: { include_tools?: boolean; max_chars?: number }) {
  return {
    includeTools: params.include_tools ?? false,
    maxChars: params.max_chars ?? DEFAULT_MAX_CHARS,
  };
}

function page<T>(items: readonly T[], offset: number | undefined, limit = 50) {
  const start = offset ?? Math.max(0, items.length - limit);
  return { total: items.length, offset: start, items: items.slice(start, start + limit) };
}

function jsonResult<T extends object>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: undefined,
    structuredContent: value,
  };
}

const listTool = defineTool({
  name: "session_list",
  label: "Session list",
  description:
    "List past pi sessions, newest first, with the first user message of each. Use session_read to read one.",
  exposure: "codemode",
  namespace: NAMESPACE,
  annotations: { readOnlyHint: true },
  parameters: Type.Object({
    scope: Scope,
    limit: Type.Optional(
      Type.Integer({ minimum: 1, description: "Maximum sessions. Default: 20" }),
    ),
  }),
  outputSchema: Type.Object({ total: Type.Number(), sessions: Type.Array(SessionSummarySchema) }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const all = await listSummaries(ctx, params.scope);
    return jsonResult({ total: all.length, sessions: all.slice(0, params.limit ?? 20) });
  },
});

const readTool = defineTool({
  name: "session_read",
  label: "Session read",
  description:
    "Read the transcript of the active branch of a past pi session. Without offset, it returns the last `limit` items. Compaction summaries have the role `summary`.",
  exposure: "codemode",
  namespace: NAMESPACE,
  annotations: { readOnlyHint: true },
  parameters: Type.Object({
    session: Type.String({ description: "Session ID, unique ID prefix, name, or file path" }),
    scope: Scope,
    offset: Type.Optional(Type.Integer({ minimum: 0, description: "Index of the first item" })),
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum items. Default: 50" })),
    include_tools: IncludeTools,
    max_chars: MaxChars,
  }),
  outputSchema: Type.Object({
    session: SessionSummarySchema,
    total: Type.Number(),
    offset: Type.Number(),
    items: Type.Array(Item),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const session = resolveSession(await listSummaries(ctx, params.scope), params.session);
    const items = await readTranscript(session.path, transcriptOptions(params));
    return jsonResult({ session, ...page(items, params.offset, params.limit) });
  },
});

const searchTool = defineTool({
  name: "session_search",
  label: "Session search",
  description:
    "Search the messages of past pi sessions. An item matches when it contains all words of the query (case-insensitive). Newest matches first.",
  exposure: "codemode",
  namespace: NAMESPACE,
  annotations: { readOnlyHint: true },
  parameters: Type.Object({
    query: Type.String({ description: "Words to find" }),
    scope: Scope,
    limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum matches. Default: 20" })),
    include_tools: IncludeTools,
    max_chars: MaxChars,
  }),
  outputSchema: Type.Object({
    hits: Type.Array(
      Type.Object({
        ...Item.properties,
        sessionId: Type.String(),
        sessionName: Type.Optional(Type.String()),
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const hits = await searchSessions(await listSessions(ctx, params.scope), {
      query: params.query,
      limit: params.limit ?? 20,
      ...transcriptOptions(params),
    });
    return jsonResult({ hits });
  },
});

/**
 * Adds the `session_list`, `session_read`, and `session_search` tools. Codemode scripts use them to
 * read the history of past pi sessions.
 */
export default function sessionHistory(pi: ExtensionAPI): void {
  pi.registerTool(listTool);
  pi.registerTool(readTool);
  pi.registerTool(searchTool);
}
