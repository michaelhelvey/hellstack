import { StringEnum } from "@earendil-works/pi-ai";
import {
  defineTool,
  type AgentToolResult,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

import { formatTodoId, normalizeTodoId } from "./ids.ts";
import { groupTodos, type TodoFrontMatter, type TodoRecord } from "./model.ts";
import {
  appendExpandHint,
  renderTodoDetail,
  renderTodoList,
  serializeTodoForAgent,
  serializeTodoListForAgent,
} from "./render.ts";
import { getTodosDir, TodoStore, type TodoResult } from "./store.ts";

const TODO_ACTIONS = [
  "list",
  "list-all",
  "get",
  "create",
  "update",
  "append",
  "delete",
  "claim",
  "release",
] as const;

/** The parameter schema of the `todo` tool. */
export const TodoParams = Type.Object({
  action: StringEnum(TODO_ACTIONS),
  id: Type.Optional(Type.String({ description: "Todo id (TODO-<hex> or raw hex filename)" })),
  title: Type.Optional(Type.String({ description: "Short summary shown in lists" })),
  status: Type.Optional(Type.String({ description: "Todo status" })),
  tags: Type.Optional(Type.Array(Type.String({ description: "Todo tag" }))),
  body: Type.Optional(
    Type.String({ description: "Long-form details (markdown). Update replaces; append adds." }),
  ),
  force: Type.Optional(Type.Boolean({ description: "Override another session's assignment" })),
});

/** The parameters of one `todo` tool call. */
export type TodoToolParams = Static<typeof TodoParams>;

type TodoAction = TodoToolParams["action"];
type ListAction = Extract<TodoAction, "list" | "list-all">;
type SingleAction = Exclude<TodoAction, ListAction>;

/** The details of a `todo` tool result, which the renderer uses. */
export type TodoToolDetails =
  | { action: ListAction; todos: TodoFrontMatter[]; currentSessionId: string }
  | { action: SingleAction; todo: TodoRecord }
  | { action: TodoAction; error: string };

/** The result of a `todo` tool call. */
export type TodoToolResult = AgentToolResult<TodoToolDetails>;

const ACTION_LABELS: Partial<Record<SingleAction, string>> = {
  create: "Created",
  update: "Updated",
  append: "Appended to",
  delete: "Deleted",
  claim: "Claimed",
  release: "Released",
};

function textResult(text: string, details: TodoToolDetails): TodoToolResult {
  return { content: [{ type: "text", text }], details };
}

function errorResult(action: TodoAction, error: string, text = error): TodoToolResult {
  return textResult(text, { action, error });
}

function missingFieldResult(action: TodoAction, field: string): TodoToolResult {
  return errorResult(action, `${field} required`, `Error: ${field} required`);
}

function todoResult(action: SingleAction, result: TodoResult): TodoToolResult {
  if ("error" in result) return errorResult(action, result.error);
  return textResult(serializeTodoForAgent(result.todo), { action, todo: result.todo });
}

async function listResult(store: TodoStore, action: ListAction): Promise<TodoToolResult> {
  const all = await store.list();
  const groups = groupTodos(all);
  const todos = action === "list" ? [...groups.assigned, ...groups.open] : all;
  const details = { action, todos, currentSessionId: store.session.id };
  return textResult(serializeTodoListForAgent(todos), details);
}

async function createResult(store: TodoStore, params: TodoToolParams): Promise<TodoToolResult> {
  if (!params.title) return missingFieldResult("create", "title");
  const { title, tags, status, body } = params;
  return todoResult("create", await store.create({ title, tags, status, body }));
}

type TodoHandler = (store: TodoStore, params: TodoToolParams) => Promise<TodoToolResult>;

function withId(
  action: SingleAction,
  run: (store: TodoStore, id: string, params: TodoToolParams) => Promise<TodoResult>,
): TodoHandler {
  return async (store, params) => {
    if (!params.id) return missingFieldResult(action, "id");
    return todoResult(action, await run(store, params.id, params));
  };
}

const TODO_HANDLERS: Record<TodoAction, TodoHandler> = {
  list: (store) => listResult(store, "list"),
  "list-all": (store) => listResult(store, "list-all"),
  get: withId("get", (store, id) => store.get(id)),
  create: createResult,
  update: withId("update", (store, id, { title, status, tags, body }) =>
    store.update(id, { title, status, tags, body }),
  ),
  append: withId("append", (store, id, params) => store.append(id, params.body ?? "")),
  delete: withId("delete", (store, id) => store.delete(id)),
  claim: withId("claim", (store, id, params) => store.claim(id, params.force)),
  release: withId("release", (store, id, params) => store.release(id, params.force)),
};

/** Runs one `todo` tool call against a store. */
export function runTodoAction(store: TodoStore, params: TodoToolParams): Promise<TodoToolResult> {
  return TODO_HANDLERS[params.action](store, params);
}

/** Makes a todo store for the working directory and the session of an extension context. */
export function createTodoStore(ctx: ExtensionContext): TodoStore {
  return new TodoStore(getTodosDir(ctx.cwd), {
    id: ctx.sessionManager.getSessionId(),
    file: ctx.sessionManager.getSessionFile(),
    confirm: ctx.hasUI ? (title, message) => ctx.ui.confirm(title, message) : undefined,
  });
}

function renderCall(args: TodoToolParams, theme: Theme): Text {
  const id = args.id ? normalizeTodoId(args.id) : "";
  const parts = [
    theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action),
    id ? theme.fg("accent", formatTodoId(id)) : "",
    args.title ? theme.fg("dim", `"${args.title}"`) : "",
  ];
  return new Text(parts.filter(Boolean).join(" "), 0, 0);
}

function renderSingle(
  theme: Theme,
  details: { action: SingleAction; todo: TodoRecord },
  expanded: boolean,
): string {
  const text = renderTodoDetail(theme, details.todo, expanded);
  const label = ACTION_LABELS[details.action];
  const labeled = label ? theme.fg("success", "✓ ") + theme.fg("muted", `${label} `) + text : text;
  return expanded ? labeled : appendExpandHint(theme, labeled);
}

function renderList(
  theme: Theme,
  details: { todos: TodoFrontMatter[]; currentSessionId: string },
  expanded: boolean,
): string {
  const { todos, currentSessionId } = details;
  const text = renderTodoList(theme, todos, { expanded, currentSessionId });
  const hasHidden = !expanded && groupTodos(todos).closed.length > 0;
  return hasHidden ? appendExpandHint(theme, text) : text;
}

function renderDetails(theme: Theme, details: TodoToolDetails, expanded: boolean): string {
  if ("error" in details) return theme.fg("error", `Error: ${details.error}`);
  if ("todo" in details) return renderSingle(theme, details, expanded);
  return renderList(theme, details, expanded);
}

function firstText(result: Partial<TodoToolResult>): string {
  const [first] = result.content ?? [];
  return first?.type === "text" ? first.text : "";
}

function renderResultText(
  theme: Theme,
  result: Partial<TodoToolResult>,
  options: { expanded: boolean; isPartial: boolean },
): string {
  if (options.isPartial) return theme.fg("warning", "Processing...");
  return result.details
    ? renderDetails(theme, result.details, options.expanded)
    : firstText(result);
}

function todoToolDescription(todosDirLabel: string): string {
  return (
    `Manage file-based todos in ${todosDirLabel} (list, list-all, get, create, update, append, delete, claim, release). ` +
    "Title is the short summary; body is long-form markdown notes (update replaces, append adds). " +
    "Todo ids are shown as TODO-<hex>; id parameters accept TODO-<hex> or the raw hex filename. " +
    "Claim tasks before working on them to avoid conflicts, and close them when complete."
  );
}

/** Returns the `todo` tool definition. `todosDirLabel` is the todo folder that the description names. */
export function createTodoTool(todosDirLabel: string) {
  return defineTool<typeof TodoParams, TodoToolDetails>({
    name: "todo",
    label: "Todo",
    description: todoToolDescription(todosDirLabel),
    parameters: TodoParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runTodoAction(createTodoStore(ctx), params),
    renderCall,
    renderResult: (result, { expanded, isPartial }, theme) =>
      new Text(renderResultText(theme, result, { expanded, isPartial }), 0, 0),
  });
}
