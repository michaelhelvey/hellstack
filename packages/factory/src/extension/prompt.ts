import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readIfExists } from "../core/files.ts";
import { getTask } from "../core/ledger.ts";
import { promptPath, taskPath, type LedgerPaths } from "../core/paths.ts";
import { UNTITLED_TITLE, type TaskMeta } from "../core/task.ts";
import type { Role, TaskRole } from "./role.ts";

/** The folder of the `factory` skill. Only the coordinator loads it. */
export const FACTORY_SKILL_DIR = fileURLToPath(new URL("../../skills/factory", import.meta.url));

/** System prompt sections, keyed by XML tag name. */
export type Sections = Record<string, string>;

const packageFiles = new Map<string, Promise<string>>();

function packageFile(path: string): Promise<string> {
  const text = packageFiles.get(path) ?? readFile(path, "utf8").then((value) => value.trim());
  packageFiles.set(path, text);
  return text;
}

function prompt(name: string): Promise<string> {
  return packageFile(promptPath(name));
}

async function skillBody(): Promise<string> {
  const text = await packageFile(join(FACTORY_SKILL_DIR, "SKILL.md"));
  return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

function taskIntro(role: TaskRole, paths: LedgerPaths): string {
  return `Your task is ${role.task}. Your task file is ${taskPath(paths, role.task)}. The factory ledger is ${paths.home}.`;
}

/** Returns the prompt of a design session whose task is no longer a `sketch`. */
export function designDonePrompt(role: TaskRole, paths: LedgerPaths, status: string): string {
  return [
    "# Factory design",
    "",
    `You helped the user write the contract of factory task ${role.task} (${taskPath(paths, role.task)}). The task is now \`${status}\`, so the design is done.`,
    "",
    `- Do not edit the task file. The coordinator and the worker own it now. When the user wants to change the contract, tell them to talk to the coordinator (terminal \`factory\`) or to the worker (terminal \`factory-${role.task}\`).`,
    "- To start a new task, the user can click `+ new task` on the factory board, or run `/sketch <title>` in a new session.",
  ].join("\n");
}

async function coordinatorSections(paths: LedgerPaths): Promise<Sections> {
  const memory = (await readIfExists(paths.coordinator)) ?? "COORDINATOR.md does not exist.";
  return {
    factory_coordinator: `${await skillBody()}\n\nThe factory ledger is ${paths.home}.`,
    factory_memory: `This is ${paths.coordinator}, your memory. Edit that file to change it.\n\n${memory.trim()}`,
  };
}

async function workerSections(role: TaskRole, paths: LedgerPaths): Promise<Sections> {
  return { factory_worker: `${await prompt("WORKER.md")}\n\n${taskIntro(role, paths)}` };
}

/**
 * The part of the design prompt for a sketch with the title {@link UNTITLED_TITLE}. It shows until
 * the agent sets a real title.
 */
export const UNTITLED_PROMPT = `The task has no title yet (\`${UNTITLED_TITLE}\`), and its \`cwd\` is only the factory ledger. Before you do other work, ask the user what the task is and in which folder (usually a repository) the worker must work. Then set a real title and that \`cwd\` with \`factory_task\` \`update\`.`;

async function taskMeta(id: string, paths: LedgerPaths): Promise<TaskMeta | undefined> {
  return (await getTask(id, paths).catch(() => undefined))?.meta;
}

function designIntro(role: TaskRole, paths: LedgerPaths, title: string): string {
  const intro = taskIntro(role, paths);
  return title === UNTITLED_TITLE ? `${intro}\n\n${UNTITLED_PROMPT}` : intro;
}

async function designSections(role: TaskRole, paths: LedgerPaths): Promise<Sections> {
  const meta = await taskMeta(role.task, paths);
  if (meta?.status !== "sketch") {
    return { factory_design: designDonePrompt(role, paths, meta?.status ?? "missing") };
  }
  const [design, template] = await Promise.all([
    prompt("DESIGN-AGENT.md"),
    prompt("task-template.md"),
  ]);
  const intro = designIntro(role, paths, meta.title);
  return { factory_design: `${design}\n\n${intro}\n\nThe task template:\n\n${template}` };
}

function ownSections(role: Role, paths: LedgerPaths): Promise<Sections> {
  if (role.kind === "coordinator") return coordinatorSections(paths);
  if (role.kind === "worker") return workerSections(role, paths);
  if (role.kind === "design") return designSections(role, paths);
  return Promise.resolve({});
}

/**
 * Returns the system prompt sections of `role`. Every role except `none` gets `chinchilla.md`. It
 * reads `COORDINATOR.md` and the task status each time, so a change applies at the next turn. It
 * reads the files of this package one time.
 */
export async function roleSections(role: Role, paths: LedgerPaths): Promise<Sections> {
  if (role.kind === "none") return {};
  return { factory_rules: await prompt("chinchilla.md"), ...(await ownSections(role, paths)) };
}
