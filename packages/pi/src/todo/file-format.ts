import { z } from "zod";

import { parseJsonOrUndefined } from "../shared/json.ts";
import type { TodoFrontMatter, TodoRecord } from "./model.ts";

const FrontMatterSchema = z.object({
  title: z.string().catch(""),
  tags: z
    .array(z.string().nullable().catch(null))
    .catch([])
    .transform((tags) => tags.filter((tag) => tag !== null)),
  status: z.string().min(1).catch("open"),
  created_at: z.string().catch(""),
  assigned_to_session: z
    .string()
    .refine((session) => session.trim().length > 0)
    .optional()
    .catch(undefined),
});

const SafeFrontMatterSchema = FrontMatterSchema.catch(FrontMatterSchema.parse({}));

const DEPTH_CHANGE: Partial<Record<string, number>> = { "{": 1, "}": -1 };

interface ScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

function scanStringChar(state: ScanState, char: string): void {
  if (state.escaped) {
    state.escaped = false;

    return;
  }

  state.escaped = char === "\\";
  state.inString = char !== '"';
}

function depthChange(char: string): number {
  return DEPTH_CHANGE[char] ?? 0;
}

function scanChar(state: ScanState, char: string): boolean {
  if (state.inString) {
    scanStringChar(state, char);

    return false;
  }

  state.inString = char === '"';
  state.depth += depthChange(char);

  return char === "}" && state.depth === 0;
}

function findJsonObjectEnd(content: string): number {
  const state: ScanState = { depth: 0, inString: false, escaped: false };

  for (let i = 0; i < content.length; i += 1) {
    if (scanChar(state, content.charAt(i))) return i;
  }

  return -1;
}

/**
 * Splits the content of a todo file into the JSON front matter and the markdown body.
 * If the content does not start with a complete JSON object, all of the content is the body.
 */
export function splitFrontMatter(content: string): { frontMatter: string; body: string } {
  const endIndex = content.startsWith("{") ? findJsonObjectEnd(content) : -1;

  if (endIndex === -1) return { frontMatter: "", body: content };

  return {
    frontMatter: content.slice(0, endIndex + 1),
    body: content.slice(endIndex + 1).replace(/^\r?\n+/, ""),
  };
}

/**
 * Parses the JSON front matter of a todo. Fields that are missing or not valid get default values.
 * The id always comes from the file name.
 */
export function parseFrontMatter(text: string, id: string): TodoFrontMatter {
  return { id, ...SafeFrontMatterSchema.parse(parseJsonOrUndefined(text)) };
}

/** Parses the full content of a todo file. */
export function parseTodoContent(content: string, id: string): TodoRecord {
  const { frontMatter, body } = splitFrontMatter(content);

  return { ...parseFrontMatter(frontMatter, id), body };
}

/** Converts a todo to the content of a todo file. */
export function serializeTodo(todo: TodoRecord): string {
  const frontMatter = JSON.stringify(
    {
      id: todo.id,
      title: todo.title,
      tags: todo.tags,
      status: todo.status,
      created_at: todo.created_at,
      assigned_to_session: todo.assigned_to_session || undefined,
    },
    null,
    2,
  );

  const body = todo.body.replace(/^\n+/, "").replace(/\s+$/, "");

  return body ? `${frontMatter}\n\n${body}\n` : `${frontMatter}\n`;
}
