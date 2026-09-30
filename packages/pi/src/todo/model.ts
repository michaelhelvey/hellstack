import { fuzzyMatch } from "@earendil-works/pi-tui";

import { formatTodoId } from "./ids.ts";

/** The metadata of a todo. The todo file keeps it as a JSON object before the body. */
export interface TodoFrontMatter {
  id: string;
  title: string;
  tags: string[];
  status: string;
  created_at: string;
  assigned_to_session?: string | undefined;
}

/** A todo with its markdown body. */
export interface TodoRecord extends TodoFrontMatter {
  body: string;
}

/** The state of a todo: assigned to a session, open, or closed. */
export type TodoState = "assigned" | "open" | "closed";

/** Todos in groups by state. */
export type TodoGroups = Record<TodoState, TodoFrontMatter[]>;

/** All todo states, in display order. */
export const TODO_STATES: readonly TodoState[] = ["assigned", "open", "closed"];

/** Returns true if the status means that the todo is complete. */
export function isTodoClosed(status: string): boolean {
  return ["closed", "done"].includes(status.toLowerCase());
}

/** Returns the title of a todo, or a placeholder if the title is empty. */
export function getTodoTitle(todo: TodoFrontMatter): string {
  return todo.title || "(untitled)";
}

/** Returns the status of a todo. An empty status is "open". */
export function getTodoStatus(todo: TodoFrontMatter): string {
  return todo.status || "open";
}

/** Removes the session assignment from a todo if the todo is closed. */
export function clearAssignmentIfClosed(todo: TodoFrontMatter): void {
  if (isTodoClosed(getTodoStatus(todo))) todo.assigned_to_session = undefined;
}

/** Returns the state of a todo. */
export function getTodoState(todo: TodoFrontMatter): TodoState {
  if (isTodoClosed(getTodoStatus(todo))) return "closed";
  return todo.assigned_to_session ? "assigned" : "open";
}

function stateRank(todo: TodoFrontMatter): number {
  return TODO_STATES.indexOf(getTodoState(todo));
}

/** Sorts todos: assigned todos first, then open todos, then closed todos. Older todos go first. */
export function sortTodos(todos: TodoFrontMatter[]): TodoFrontMatter[] {
  return [...todos].sort(
    (a, b) => stateRank(a) - stateRank(b) || a.created_at.localeCompare(b.created_at),
  );
}

/** Puts todos into groups by state. The order in each group does not change. */
export function groupTodos(todos: TodoFrontMatter[]): TodoGroups {
  const groups: TodoGroups = { assigned: [], open: [], closed: [] };
  for (const todo of todos) groups[getTodoState(todo)].push(todo);
  return groups;
}

function buildSearchText(todo: TodoFrontMatter): string {
  const assignment = todo.assigned_to_session ? `assigned:${todo.assigned_to_session}` : "";
  const fields = [formatTodoId(todo.id), todo.id, todo.title, ...todo.tags, todo.status];
  return [...fields, assignment].join(" ").trim();
}

function scoreTodo(todo: TodoFrontMatter, tokens: string[]): number | undefined {
  const text = buildSearchText(todo);
  let total = 0;
  for (const token of tokens) {
    const result = fuzzyMatch(token, text);
    if (!result.matches) return undefined;
    total += result.score;
  }
  return total;
}

/**
 * Returns the todos that fuzzy match all words of the query. The result has assigned todos
 * first, then open todos, then closed todos. In each group, better matches go first.
 */
export function filterTodos(todos: TodoFrontMatter[], query: string): TodoFrontMatter[] {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return todos;
  return todos
    .map((todo) => ({ todo, score: scoreTodo(todo, tokens) }))
    .filter((match): match is { todo: TodoFrontMatter; score: number } => match.score !== undefined)
    .sort((a, b) => stateRank(a.todo) - stateRank(b.todo) || a.score - b.score)
    .map((match) => match.todo);
}
