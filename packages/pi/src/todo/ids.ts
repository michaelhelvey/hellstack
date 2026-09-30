/** The prefix that shows before each todo id. */
export const TODO_ID_PREFIX = "TODO-";

const TODO_ID_PATTERN = /^[a-f0-9]{8}$/i;

/** Returns the display form (`TODO-<hex>`) of a raw todo id. */
export function formatTodoId(id: string): string {
  return `${TODO_ID_PREFIX}${id}`;
}

/** Removes the optional `#` and `TODO-` prefixes from a todo id. */
export function normalizeTodoId(id: string): string {
  const trimmed = id.trim().replace(/^#/, "");
  const hasPrefix = trimmed.toUpperCase().startsWith(TODO_ID_PREFIX);
  return hasPrefix ? trimmed.slice(TODO_ID_PREFIX.length) : trimmed;
}

/**
 * Parses a todo id in the form `TODO-<hex>`, `#<hex>`, or `<hex>`.
 * Returns the lowercase hex id, or undefined if the id is not valid.
 */
export function parseTodoId(id: string): string | undefined {
  const normalized = normalizeTodoId(id);
  return TODO_ID_PATTERN.test(normalized) ? normalized.toLowerCase() : undefined;
}

/** Returns the display form of a todo id that can have a prefix. */
export function displayTodoId(id: string): string {
  return formatTodoId(normalizeTodoId(id));
}
