import { createHash } from "node:crypto";
import { join } from "node:path";

import { type FileData, listFiles, readFileData } from "@hellstack/sync";

/** Files by their path, relative to the root of the tree. */
export type Tree = Map<string, FileData>;

/** Changes the text of one file. It throws when the text is not as the edit expects. */
export type Edit = (text: string) => string;

/** A file in hellstack that replaces an upstream file, or adds a new file. */
export interface Override {
  /**
   * The `upstreamHash` of the upstream file that the override replaces, or `null` for a new file.
   * The patch stops when the upstream file changes, so that you can do a check of the override.
   */
  upstream: string | null;
}

/** The changes that hellstack makes to an upstream tree. */
export interface PatchSet {
  /** The upstream files and directories to copy. */
  include: string[];
  /** The upstream files and directories in `include` to leave out. */
  drop: string[];
  /** The overrides by path. The override files are in the overrides directory, at the same path. */
  overrides: Record<string, Override>;
  /** The edits by path. Each edit applies after the overrides. */
  edits: Record<string, Edit[]>;
  /** Text that no file in the patched tree can contain. */
  forbidden: RegExp[];
  /**
   * Lines to remove from every Markdown file, for example the lines that point to a runtime that
   * the patched tree is not for. The lines go before the edits apply.
   */
  dropLines?: RegExp[];
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Returns the short hash of a file that `Override.upstream` uses. */
export function upstreamHash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

function expectOnce(text: string, part: string): void {
  const found = count(text, part);
  if (found !== 1) throw new Error(`expected 1 match of ${JSON.stringify(part)}, found ${found}`);
}

/** Makes an edit that replaces `find` with `replace`. `find` must occur one time. */
export function replaceOnce(find: string, replace: string): Edit {
  return (text) => {
    expectOnce(text, find);
    return text.replace(find, () => replace);
  };
}

function expectOneLine(lines: string[], part: string): void {
  const found = lines.filter((line) => line.includes(part)).length;
  if (found !== 1) throw new Error(`expected 1 line with ${JSON.stringify(part)}, found ${found}`);
}

/** Makes an edit that removes the line that contains `part`. One line must contain it. */
export function removeLine(part: string): Edit {
  return (text) => {
    const lines = text.split("\n");
    expectOneLine(lines, part);
    return lines.filter((line) => !line.includes(part)).join("\n");
  };
}

/** Makes an edit that replaces the line that contains `part` with `line`. One line must contain it. */
export function replaceLine(part: string, line: string): Edit {
  return (text) => {
    const lines = text.split("\n");
    expectOneLine(lines, part);
    return lines.map((next) => (next.includes(part) ? line : next)).join("\n");
  };
}

/**
 * Makes an edit that replaces the body of a Markdown section. `heading` is the full heading line,
 * for example `## Comments`. The body ends at the next heading of the same or a higher level.
 */
export function replaceSection(heading: string, body: string): Edit {
  return (text) => {
    const { start, end } = findSection(text, heading);
    const bodyStart = start + heading.length + 1;
    return `${text.slice(0, bodyStart)}\n${body.trim()}\n\n${text.slice(end)}`;
  };
}

/** Makes an edit that removes a Markdown section, its heading included. */
export function removeSection(heading: string): Edit {
  return (text) => {
    const { start, end } = findSection(text, heading);
    return text.slice(0, start) + text.slice(end);
  };
}

/**
 * Finds a Markdown section. `start` is the index of its heading line, and `end` is the index of the
 * next heading of the same or a higher level, or the end of the text.
 */
function findSection(text: string, heading: string): { start: number; end: number } {
  expectOnce(text, `\n${heading}\n`);
  const start = text.indexOf(`\n${heading}\n`) + 1;
  const bodyStart = start + heading.length + 1;
  const next = new RegExp(`\\n#{1,${heading.indexOf(" ")}} `).exec(text.slice(bodyStart));
  return { start, end: next === null ? text.length : bodyStart + next.index + 1 };
}

function isUnder(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Reads the files of `dir` that `include` names and `drop` does not name. */
export async function readTree(dir: string, include: string[], drop: string[]): Promise<Tree> {
  const paths = (await listFiles(dir)).filter((p) => isUnder(p, include) && !isUnder(p, drop));
  const files = await Promise.all(paths.map((path) => readFileData(join(dir, path))));
  return new Map(paths.map((path, index) => [path, files[index]!]));
}

function checkUpstream(path: string, file: FileData | undefined, override: Override): void {
  const actual = file === undefined ? null : upstreamHash(file.content);
  if (actual === override.upstream) return;
  throw new Error(
    `${path}: the upstream file changed since the override was written (${override.upstream} -> ${actual}). Compare the override with the upstream file, then set upstream to ${JSON.stringify(actual)}.`,
  );
}

async function applyOverrides(tree: Tree, set: PatchSet, overridesDir: string): Promise<void> {
  for (const [path, override] of Object.entries(set.overrides)) {
    checkUpstream(path, tree.get(path), override);
    tree.set(path, await readFileData(join(overridesDir, path)));
  }
}

function editFile(file: FileData, edits: Edit[]): FileData {
  const text = edits.reduce((next, edit) => edit(next), decoder.decode(file.content));
  return { ...file, content: encoder.encode(text) };
}

function dropMatchingLines(tree: Tree, patterns: RegExp[]): void {
  const markdown = [...tree].filter(([path]) => path.endsWith(".md"));
  for (const [path, file] of markdown) {
    const lines = decoder.decode(file.content).split("\n");
    const kept = lines.filter((line) => !patterns.some((pattern) => pattern.test(line)));
    tree.set(path, { ...file, content: encoder.encode(kept.join("\n")) });
  }
}

function applyEdits(tree: Tree, set: PatchSet): void {
  for (const [path, edits] of Object.entries(set.edits)) {
    const file = tree.get(path);
    if (file === undefined) throw new Error(`${path}: there is no file to edit`);
    try {
      tree.set(path, editFile(file, edits));
    } catch (error) {
      throw new Error(`${path}: ${(error as Error).message}`, { cause: error });
    }
  }
}

/** Returns one line for each file in the tree that contains forbidden text. */
export function findForbidden(tree: Tree, forbidden: RegExp[]): string[] {
  return [...tree].flatMap(([path, file]) => {
    const text = decoder.decode(file.content);
    return forbidden.filter((pattern) => pattern.test(text)).map((p) => `${path}: ${p.source}`);
  });
}

/**
 * Applies a patch set to the upstream tree in `dir`. It throws an error when an override, an edit,
 * or the forbidden text check fails. The error tells you what to change after an upstream update.
 */
export async function patchTree(dir: string, set: PatchSet, overridesDir: string): Promise<Tree> {
  const tree = await readTree(dir, set.include, set.drop);
  await applyOverrides(tree, set, overridesDir);
  dropMatchingLines(tree, set.dropLines ?? []);
  applyEdits(tree, set);
  const found = findForbidden(tree, set.forbidden);
  if (found.length > 0)
    throw new Error(`the patched tree has forbidden text:\n${found.join("\n")}`);
  return tree;
}
