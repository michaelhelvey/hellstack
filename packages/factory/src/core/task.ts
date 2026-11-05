import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { parse, stringify } from "yaml";
import { z } from "zod";

/** The lifecycle states of a task. */
export const taskStatusSchema = z.enum([
  "sketch",
  "ready",
  "working",
  "landing",
  "landed",
  "dropped",
]);

/** A task id: `t-` and 4 to 8 lowercase hex digits. */
export const taskIdSchema = z.string().regex(/^t-[0-9a-f]{4,8}$/, "not a valid task id");

/**
 * The status changes that `updateTask` can make. Only handoff moves a `sketch` to `ready`. A
 * `landing` task can go back to `working`, and a `ready` task can go back to `sketch`. A `working`
 * task can go to `landed` directly when its landing completes at once (for example, a local commit).
 */
export const statusTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  sketch: ["dropped"],
  ready: ["sketch", "working", "dropped"],
  working: ["landing", "landed", "dropped"],
  landing: ["working", "landed", "dropped"],
  landed: [],
  dropped: [],
};

/** The statuses in which `updateTask` can change `cwd`. */
export const cwdStatuses: readonly TaskStatus[] = ["sketch", "ready"];

const legacyRepoSchema = z
  .looseObject({ repo: z.string() })
  .transform(({ repo, ...rest }) => ({ cwd: repo, ...rest }));

const metaFieldsSchema = z.looseObject({
  id: taskIdSchema,
  title: z.string().min(1),
  status: taskStatusSchema,
  cwd: z.string().refine(isAbsolute, "cwd must be an absolute path"),
  threads: z.array(z.string()).default([]),
  paused: z.boolean().default(false),
  needs_you: z.string().nullable().default(null),
  now: z.string().default(""),
  created: z.iso.datetime({ offset: true }),
  updated: z.iso.datetime({ offset: true }),
  landed_at: z.iso.datetime({ offset: true }).nullable().default(null),
});

/**
 * The front matter of a task file. Unknown fields stay in the file. Times can have a UTC offset. An
 * old file has `repo` instead of `cwd`: the schema reads it as `cwd`, so the next write has `cwd`.
 */
export const taskMetaSchema = z.preprocess(
  (raw) => legacyRepoSchema.safeParse(raw).data ?? raw,
  metaFieldsSchema,
);

/** The lifecycle state of a task. */
export type TaskStatus = z.infer<typeof taskStatusSchema>;
/** The front matter of a task file. */
export type TaskMeta = z.infer<typeof metaFieldsSchema>;

/** A task file: the front matter and the Markdown body exactly as it is in the file. */
export interface Task {
  meta: TaskMeta;
  body: string;
}

/** One checkbox item in the Landing section. `line` is the 0-based line in the body. */
export interface LandingItem {
  line: number;
  done: boolean;
  text: string;
}

/** The count of checked items and of all items in the Landing section. */
export interface LandingProgress {
  done: number;
  total: number;
}

/** The sections that must have text before handoff. */
export const contractSections = ["Goal", "Verification", "Output", "Constraints"] as const;

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HEADING = /^## +(\S.*?)\s*$/;
const FENCE = /^\s*(?:```|~~~)/;
const CHECKBOX = /^\s*[-*+] \[([ xX])\]\s*(.*)$/;

interface BodyLine {
  section: string | undefined;
  heading: boolean;
  code: boolean;
  visible: string;
}

/**
 * Parses the text of a task file. Throws when the front matter is missing or not valid. It removes
 * a byte order mark at the start.
 */
export function parseTask(fileText: string): Task {
  const text = fileText.replace(/^\uFEFF/, "");
  const match = FRONT_MATTER.exec(text);
  if (!match) throw new Error("the task file has no front matter");
  const meta = taskMetaSchema.parse(parse(match[1] ?? ""));
  return { meta, body: text.slice(match[0].length) };
}

/** Returns the text of a task file. The body is written exactly as it is. */
export function serializeTask(task: Task): string {
  return `---\n${stringify(taskMetaSchema.parse(task.meta), { lineWidth: 0 })}---\n${task.body}`;
}

function codeLines(lines: string[]): boolean[] {
  let fenced = false;
  return lines.map((line) => {
    const fence = FENCE.test(line);
    const code = fenced || fence;
    fenced = fenced !== fence;
    return code;
  });
}

function scanBody(body: string): BodyLine[] {
  const masked = body.replace(COMMENT, (comment) => comment.replace(/[^\n]/g, " "));
  const lines = masked.split("\n");
  const code = codeLines(lines);
  let section: string | undefined;
  return lines.map((visible, index) => {
    const heading = code[index] ? undefined : HEADING.exec(visible)?.[1];
    section = heading ?? section;
    return { section, heading: heading !== undefined, code: code[index] ?? false, visible };
  });
}

/**
 * Returns the text of the `## <name>` section without HTML comments, trimmed. Returns undefined
 * when the body has no such section.
 */
export function sectionText(body: string, name: string): string | undefined {
  const lines = scanBody(body).filter((line) => line.section === name);
  if (lines.length === 0) return undefined;
  return lines
    .filter((line) => !line.heading)
    .map((line) => line.visible)
    .join("\n")
    .trim();
}

/**
 * Returns the checkbox items of the Landing section. Items in HTML comments and in code blocks do
 * not count.
 */
export function landingItems(body: string): LandingItem[] {
  return scanBody(body).flatMap(landingItem);
}

function checkboxMatch(line: BodyLine): RegExpExecArray | null {
  return line.section === "Landing" && !line.code ? CHECKBOX.exec(line.visible) : null;
}

function landingItem(line: BodyLine, index: number): LandingItem[] {
  const match = checkboxMatch(line);
  return match ? [{ line: index, done: match[1] !== " ", text: (match[2] ?? "").trim() }] : [];
}

/** Returns the landing progress of a task body. */
export function landingProgress(body: string): LandingProgress {
  const items = landingItems(body);
  return { done: items.filter((item) => item.done).length, total: items.length };
}

/** Returns the body with Landing item `number` (1-based) checked. Throws when there is no such item. */
export function checkLandingItem(body: string, number: number): string {
  const item = landingItems(body)[number - 1];
  if (!item) throw new Error(`Landing has no item ${number}`);
  const lines = body.split("\n");
  lines[item.line] = (lines[item.line] ?? "").replace("[ ]", "[x]");
  return lines.join("\n");
}

function withLogSection(body: string, cr: string): string {
  if (sectionText(body, "Log") !== undefined) return body;
  return `${body.trimEnd()}${cr}\n${cr}\n## Log${cr}\n`;
}

/**
 * Returns the body with `entry` added as the last item of the Log section. It keeps CRLF line ends
 * when the body has them.
 */
export function appendLogEntry(body: string, entry: string): string {
  const cr = body.includes("\r\n") ? "\r" : "";
  const text = withLogSection(body, cr);
  const scanned = scanBody(text);
  const last = scanned.findLastIndex((line) => line.section === "Log" && line.visible.trim());
  const lines = text.split("\n");
  const item = `- ${entry.replace(/\s*\n\s*/g, " ")}${cr}`;
  lines.splice(last + 1, 0, ...(scanned[last]?.heading ? [cr, item] : [item]));
  return lines.join("\n");
}

async function isFolder(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/**
 * The placeholder title of a sketch that has no title from the user yet (`factory design`). Its
 * design agent asks the user what the task is, then sets a real title.
 */
export const UNTITLED_TITLE = "untitled";

/**
 * Returns what a task needs before handoff: a title that is not {@link UNTITLED_TITLE}, each
 * contract section without text, a Landing section without checkbox items, and a `cwd` that is not
 * a folder. An empty list means that it is ready.
 */
export async function validateHandoff(task: Task): Promise<string[]> {
  const missing = contractSections
    .filter((name) => !sectionText(task.body, name))
    .map((name) => `${name} has no text`);
  if (task.meta.title === UNTITLED_TITLE) missing.push(`the title is still "${UNTITLED_TITLE}"`);
  if (landingItems(task.body).length === 0) missing.push("Landing has no checkbox items");
  if (!(await isFolder(task.meta.cwd))) missing.push(`cwd is not a folder: ${task.meta.cwd}`);
  return missing;
}

/** Returns a new random task id. */
export function newTaskId(): string {
  return `t-${randomBytes(3).toString("hex")}`;
}

/**
 * The fields of a new task. `template` is the body; `now` is the ISO time of creation. `goal` is a
 * draft that goes at the start of the Goal section.
 */
export interface NewTask {
  id: string;
  title: string;
  cwd: string;
  template: string;
  now: string;
  threads?: string[] | undefined;
  goal?: string | undefined;
}

function withGoal(template: string, goal: string | undefined): string {
  return goal ? template.replace(/^## Goal\r?\n/m, (heading) => `${heading}\n${goal}\n`) : template;
}

/** Returns a new task in the `sketch` state with the template as its body. */
export function newTask({ id, title, cwd, template, now, threads, goal }: NewTask): Task {
  const meta = { id, title, cwd, threads, status: "sketch", created: now, updated: now };
  return { meta: taskMetaSchema.parse(meta), body: `\n${withGoal(template, goal)}` };
}
