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

/** The front matter of a task file. */
export const taskMetaSchema = z.object({
  id: z.string().regex(/^t-[0-9a-f]{4,8}$/),
  title: z.string().min(1),
  status: taskStatusSchema,
  repo: z.string().refine(isAbsolute, "repo must be an absolute path"),
  threads: z.array(z.string()).default([]),
  paused: z.boolean().default(false),
  needs_you: z.string().nullable().default(null),
  now: z.string().default(""),
  created: z.iso.datetime(),
  updated: z.iso.datetime(),
});

/** The lifecycle state of a task. */
export type TaskStatus = z.infer<typeof taskStatusSchema>;
/** The front matter of a task file. */
export type TaskMeta = z.infer<typeof taskMetaSchema>;

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
const CHECKBOX = /^\s*[-*+] \[([ xX])\]\s*(.*)$/;

interface BodyLine {
  section: string | undefined;
  heading: boolean;
  visible: string;
}

/** Parses the text of a task file. Throws when the front matter is missing or not valid. */
export function parseTask(text: string): Task {
  const match = FRONT_MATTER.exec(text);
  if (!match) throw new Error("the task file has no front matter");
  const meta = taskMetaSchema.parse(parse(match[1] ?? ""));
  return { meta, body: text.slice(match[0].length) };
}

/** Returns the text of a task file. The body is written exactly as it is. */
export function serializeTask(task: Task): string {
  return `---\n${stringify(taskMetaSchema.parse(task.meta), { lineWidth: 0 })}---\n${task.body}`;
}

function scanBody(body: string): BodyLine[] {
  const masked = body.replace(COMMENT, (comment) => comment.replace(/[^\n]/g, " "));
  let section: string | undefined;
  return masked.split("\n").map((visible) => {
    const heading = HEADING.exec(visible)?.[1];
    section = heading ?? section;
    return { section, heading: heading !== undefined, visible };
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

/** Returns the checkbox items of the Landing section. Items in HTML comments do not count. */
export function landingItems(body: string): LandingItem[] {
  return scanBody(body).flatMap((line, index) => {
    const match = line.section === "Landing" ? CHECKBOX.exec(line.visible) : null;
    return match ? [{ line: index, done: match[1] !== " ", text: (match[2] ?? "").trim() }] : [];
  });
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

/** Returns the body with `entry` added as the last item of the Log section. */
export function appendLogEntry(body: string, entry: string): string {
  const text = sectionText(body, "Log") === undefined ? `${body.trimEnd()}\n\n## Log\n` : body;
  const scanned = scanBody(text);
  const last = scanned.findLastIndex((line) => line.section === "Log" && line.visible.trim());
  const lines = text.split("\n");
  const item = `- ${entry.replace(/\s*\n\s*/g, " ")}`;
  lines.splice(last + 1, 0, ...(scanned[last]?.heading ? ["", item] : [item]));
  return lines.join("\n");
}

async function isFolder(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/**
 * Returns what a task needs before handoff: each contract section without text, a Landing section
 * without checkbox items, and a `repo` that is not a folder. An empty list means that it is ready.
 */
export async function validateHandoff(task: Task): Promise<string[]> {
  const missing = contractSections
    .filter((name) => !sectionText(task.body, name))
    .map((name) => `${name} has no text`);
  if (landingItems(task.body).length === 0) missing.push("Landing has no checkbox items");
  if (!(await isFolder(task.meta.repo))) missing.push(`repo is not a folder: ${task.meta.repo}`);
  return missing;
}

/** Returns a new random task id. */
export function newTaskId(): string {
  return `t-${randomBytes(3).toString("hex")}`;
}

/** The fields of a new task. `template` is the body; `now` is the ISO time of creation. */
export interface NewTask {
  id: string;
  title: string;
  repo: string;
  template: string;
  now: string;
}

/** Returns a new task in the `sketch` state with the template as its body. */
export function newTask({ id, title, repo, template, now }: NewTask): Task {
  const meta = { id, title, repo, status: "sketch", created: now, updated: now };
  return { meta: taskMetaSchema.parse(meta), body: `\n${template}` };
}
