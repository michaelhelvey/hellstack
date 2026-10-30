import { readFile } from "node:fs/promises";

import { parseSessionEntries, type SessionInfo } from "@earendil-works/pi-coding-agent";

import {
  activeBranch,
  parseEntries,
  toTranscript,
  truncate,
  type TranscriptItem,
  type TranscriptOptions,
} from "./transcript.ts";

/** A short description of one session. */
export type SessionSummary = {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  current: boolean;
};

/** One transcript item that matches a search, with the session that contains it. */
export type SearchHit = TranscriptItem & {
  sessionId: string;
  sessionName?: string;
};

/** The query and limits of a search. */
export interface SearchOptions extends TranscriptOptions {
  query: string;
  limit: number;
}

const FIRST_MESSAGE_MAX_CHARS = 500;
const SNIPPET_CONTEXT_CHARS = 200;

/** Converts the session list of pi to summaries, with the newest session first. */
export function summarize(sessions: readonly SessionInfo[], currentId: string): SessionSummary[] {
  return [...sessions]
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .map((session) => ({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      ...(session.name ? { name: session.name } : {}),
      created: session.created.toISOString(),
      modified: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstMessage: truncate(session.firstMessage.trim(), FIRST_MESSAGE_MAX_CHARS),
      current: session.id === currentId,
    }));
}

/** Finds the one session whose ID, ID prefix, name, or path is `ref`. */
export function resolveSession<T extends Pick<SessionInfo, "id" | "path" | "name">>(
  sessions: readonly T[],
  ref: string,
): T {
  const exact = sessions.find((s) => s.id === ref || s.path === ref || s.name === ref);
  if (exact) return exact;
  const matches = sessions.filter((s) => s.id.startsWith(ref));
  if (matches.length === 1 && matches[0]) return matches[0];
  const reason = matches.length === 0 ? "No session matches" : "More than one session matches";
  throw new Error(`${reason} "${ref}".`);
}

/** Reads the active branch of a session file as transcript items. */
export async function readTranscript(
  path: string,
  options: TranscriptOptions,
): Promise<TranscriptItem[]> {
  return toTranscript(activeBranch(await loadEntries(path)), options);
}

/** Finds transcript items that contain all words of the query, with the newest items first. */
export async function searchSessions(
  sessions: readonly SessionInfo[],
  options: SearchOptions,
): Promise<SearchHit[]> {
  const terms = queryTerms(options.query);
  const candidates = options.includeTools
    ? sessions
    : sessions.filter((s) => matchesAll(s.allMessagesText, terms));
  const hits = await Promise.all(candidates.map((s) => searchSession(s, terms, options)));
  return hits
    .flat()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, options.limit);
}

async function searchSession(
  session: SessionInfo,
  terms: readonly string[],
  options: TranscriptOptions,
): Promise<SearchHit[]> {
  const fullText = { ...options, maxChars: Number.POSITIVE_INFINITY };
  const items = toTranscript(await loadEntries(session.path), fullText);
  return items
    .filter((item) => matchesAll(item.text, terms))
    .map((item) => ({
      ...item,
      text: snippet(item.text, terms[0] ?? "", options.maxChars),
      sessionId: session.id,
      ...(session.name ? { sessionName: session.name } : {}),
    }));
}

async function loadEntries(path: string) {
  return parseEntries(parseSessionEntries(await readFile(path, "utf8")));
}

function queryTerms(query: string): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new Error("The query must contain at least one word.");
  return terms;
}

function matchesAll(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

/** Returns the part of `text` around the first match of `term`. */
export function snippet(text: string, term: string, maxChars: number): string {
  const index = text.toLowerCase().indexOf(term);
  const start = Math.max(0, index - SNIPPET_CONTEXT_CHARS);
  const prefix = start > 0 ? "…" : "";
  return prefix + truncate(text.slice(start), maxChars);
}
