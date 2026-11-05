import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readIfExists } from "../core/files.ts";
import { getTask } from "../core/ledger.ts";
import { promptPath, taskPath, type LedgerPaths } from "../core/paths.ts";
import type { TaskStatus } from "../core/task.ts";
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

/** Returns the prompt of a design session for the `sketch` task `role.task`. */
export function designPrompt(role: TaskRole, paths: LedgerPaths): string {
  return [
    "# Factory design",
    "",
    `You help the user write the contract of a factory task. ${taskIntro(role, paths)}`,
    "The task is a `sketch`: nothing acts on it before handoff. After handoff, a worker that has only this file does the work. The file must make sense without this conversation.",
    "",
    "- The HTML comments in the file tell what each section needs. Ask the user what you cannot find out yourself, a few questions at a time.",
    "- Write into the file as the conversation goes. Replace each comment with real text. Edit the prose with your edit tools. Change the title and the `cwd` (the folder where the worker works) with `factory_task` `update`.",
    "- When the user says that the task is ready, run `factory_handoff`. When it fails, tell the user what is missing.",
    "- Do not do the task yourself.",
  ].join("\n");
}

/** Returns the prompt of a design session whose task is no longer a `sketch`. */
export function designDonePrompt(role: TaskRole, paths: LedgerPaths, status: string): string {
  return [
    "# Factory design",
    "",
    `You helped the user write the contract of factory task ${role.task} (${taskPath(paths, role.task)}). The task is now \`${status}\`, so the design is done.`,
    "",
    `- Do not edit the task file. The coordinator and the worker own it now. When the user wants to change the contract, tell them to talk to the coordinator (terminal \`factory\`) or to the worker (terminal \`factory-${role.task}\`).`,
    "- To start a new task, the user can run `/sketch <title>` in a new session.",
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

async function taskStatus(id: string, paths: LedgerPaths): Promise<TaskStatus | "missing"> {
  return (await getTask(id, paths).catch(() => undefined))?.meta.status ?? "missing";
}

async function designSections(role: TaskRole, paths: LedgerPaths): Promise<Sections> {
  const status = await taskStatus(role.task, paths);
  if (status !== "sketch") return { factory_design: designDonePrompt(role, paths, status) };
  const template = await prompt("task-template.md");
  return {
    factory_design: `${designPrompt(role, paths)}\n\nThe task template:\n\n${template}`,
  };
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
