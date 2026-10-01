import { keyHint, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

import { formatTodoId } from "./ids.ts";
import {
  getTodoState,
  getTodoStatus,
  getTodoTitle,
  groupTodos,
  isTodoClosed,
  type TodoFrontMatter,
  type TodoRecord,
  TODO_STATES,
  type TodoState,
} from "./model.ts";

const SECTION_LABELS: Record<TodoState, string> = {
  assigned: "Assigned todos",
  open: "Open todos",
  closed: "Closed todos",
};

const COLLAPSED_SECTION_SIZE = 3;

/** Returns the tags of a todo as ` [a, b]`, or an empty string if the todo has no tags. */
export function formatTags(todo: TodoFrontMatter): string {
  return todo.tags.length ? ` [${todo.tags.join(", ")}]` : "";
}

/** Returns the one-line plain text heading of a todo. */
export function formatTodoHeading(todo: TodoFrontMatter): string {
  const assignment = todo.assigned_to_session ? ` (assigned: ${todo.assigned_to_session})` : "";

  return `${formatTodoId(todo.id)} ${getTodoTitle(todo)}${formatTags(todo)}${assignment}`;
}

/** Returns a plain text list of todos in groups by state. */
export function formatTodoList(todos: TodoFrontMatter[]): string {
  if (!todos.length) return "No todos.";
  const groups = groupTodos(todos);

  return TODO_STATES.flatMap((state) => {
    const section = groups[state];

    const items = section.length
      ? section.map((todo) => `  ${formatTodoHeading(todo)}`)
      : ["  none"];

    return [`${SECTION_LABELS[state]} (${section.length}):`, ...items];
  }).join("\n");
}

/** Returns a todo as JSON for the agent, with the id in display form. */
export function serializeTodoForAgent(todo: TodoRecord): string {
  return JSON.stringify({ ...todo, id: formatTodoId(todo.id) }, null, 2);
}

/** Returns a list of todos as JSON for the agent, in groups by state. */
export function serializeTodoListForAgent(todos: TodoFrontMatter[]): string {
  const groups = groupTodos(todos);

  const withDisplayIds = TODO_STATES.map((state) => [
    state,
    groups[state].map((todo) => ({ ...todo, id: formatTodoId(todo.id) })),
  ]);

  return JSON.stringify(Object.fromEntries(withDisplayIds), null, 2);
}

/** Returns the assignment of a todo in color, and marks the current session. */
export function renderAssignmentSuffix(
  theme: Theme,
  todo: TodoFrontMatter,
  currentSessionId?: string,
): string {
  if (!todo.assigned_to_session) return "";
  const isCurrent = todo.assigned_to_session === currentSessionId;
  const suffix = isCurrent ? ", current" : "";

  return theme.fg(
    isCurrent ? "success" : "dim",
    ` (assigned: ${todo.assigned_to_session}${suffix})`,
  );
}

/** Returns the one-line heading of a todo in color. */
export function renderTodoHeading(
  theme: Theme,
  todo: TodoFrontMatter,
  currentSessionId?: string,
): string {
  const titleColor = isTodoClosed(getTodoStatus(todo)) ? "dim" : "text";

  return (
    theme.fg("accent", formatTodoId(todo.id)) +
    " " +
    theme.fg(titleColor, getTodoTitle(todo)) +
    theme.fg("dim", formatTags(todo)) +
    renderAssignmentSuffix(theme, todo, currentSessionId)
  );
}

function renderSection(
  theme: Theme,
  todos: TodoFrontMatter[],
  options: TodoListRenderOptions,
): string[] {
  if (!todos.length) return [theme.fg("dim", "  none")];
  const shown = options.expanded ? todos : todos.slice(0, COLLAPSED_SECTION_SIZE);

  const lines = shown.map(
    (todo) => `  ${renderTodoHeading(theme, todo, options.currentSessionId)}`,
  );

  const hidden = todos.length - shown.length;

  return hidden > 0 ? [...lines, theme.fg("dim", `  ... ${hidden} more`)] : lines;
}

/** Options for {@link renderTodoList}. */
export interface TodoListRenderOptions {
  /** Show all todos. If false, show only the first todos of each group. */
  expanded: boolean;
  currentSessionId?: string | undefined;
}

/** Returns a list of todos in color, in groups by state. */
export function renderTodoList(
  theme: Theme,
  todos: TodoFrontMatter[],
  options: TodoListRenderOptions,
): string {
  if (!todos.length) return theme.fg("dim", "No todos");
  const groups = groupTodos(todos);

  return TODO_STATES.map((state) => {
    const section = groups[state];
    const heading = theme.fg("muted", `${SECTION_LABELS[state]} (${section.length})`);

    return [heading, ...renderSection(theme, section, options)].join("\n");
  }).join("\n\n");
}

/** Returns a todo in color. If `expanded` is true, includes the metadata and the body. */
export function renderTodoDetail(theme: Theme, todo: TodoRecord, expanded: boolean): string {
  const summary = renderTodoHeading(theme, todo);

  if (!expanded) return summary;
  const tags = todo.tags.length ? todo.tags.join(", ") : "none";
  const body = todo.body.trim() || "No details yet.";

  return [
    summary,
    theme.fg("muted", `Status: ${getTodoStatus(todo)}`),
    theme.fg("muted", `Tags: ${tags}`),
    theme.fg("muted", `Created: ${todo.created_at || "unknown"}`),
    "",
    theme.fg("muted", "Body:"),
    ...body.split("\n").map((line) => theme.fg("text", `  ${line}`)),
  ].join("\n");
}

/** Adds a hint about the key that expands tool output. */
export function appendExpandHint(theme: Theme, text: string): string {
  const hint = keyHint("app.tools.expand", "to expand");

  return text + "\n" + theme.fg("dim", "(" + hint + ")");
}

function selectorTitleColor(state: TodoState, selected: boolean): ThemeColor {
  if (selected) return "accent";

  return state === "closed" ? "dim" : "text";
}

/** Returns one line of the todo selector list. */
export function renderSelectorLine(
  theme: Theme,
  todo: TodoFrontMatter,
  selected: boolean,
  currentSessionId: string,
): string {
  const state = getTodoState(todo);
  const prefix = selected ? theme.fg("accent", "→ ") : "  ";
  const id = theme.fg("accent", formatTodoId(todo.id));
  const title = theme.fg(selectorTitleColor(state, selected), getTodoTitle(todo));
  const tags = theme.fg("muted", formatTags(todo));
  const assignment = renderAssignmentSuffix(theme, todo, currentSessionId);
  const status = theme.fg(state === "closed" ? "dim" : "success", `(${getTodoStatus(todo)})`);

  return `${prefix}${id} ${title}${tags}${assignment} ${status}`;
}

/** Returns the prompt that asks the agent to work on a todo. */
export function buildWorkPrompt(todo: TodoFrontMatter): string {
  return `work on todo ${formatTodoId(todo.id)} "${getTodoTitle(todo)}"`;
}

/** Returns the prompt that asks the agent to refine a todo together with the user. */
export function buildRefinePrompt(todo: TodoFrontMatter): string {
  return (
    `let's refine task ${formatTodoId(todo.id)} "${getTodoTitle(todo)}": ` +
    "Ask me for the missing details needed to refine the todo together. Do not rewrite the todo yet and do not make assumptions. " +
    "Ask clear, concrete questions and wait for my answers before drafting any structured description.\n\n"
  );
}
