import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { readIfExists } from "../core/files.ts";
import { promptPath, taskPath, type LedgerPaths } from "../core/paths.ts";
import type { Role, TaskRole } from "./role.ts";

/** The folder of the `factory` skill. Only the coordinator loads it. */
export const FACTORY_SKILL_DIR = fileURLToPath(new URL("../../skills/factory", import.meta.url));

/** System prompt sections, keyed by XML tag name. */
export type Sections = Record<string, string>;

async function prompt(name: string): Promise<string> {
  return (await readFile(promptPath(name), "utf8")).trim();
}

async function skillBody(): Promise<string> {
  const text = await readFile(`${FACTORY_SKILL_DIR}/SKILL.md`, "utf8");
  return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

function taskLine(role: TaskRole, paths: LedgerPaths): string {
  return `Your task is ${role.task}. Your task file is ${taskPath(paths, role.task)}. The factory ledger is ${paths.home}.`;
}

/** Returns the prompt of a design session for task `role.task`. */
export function designPrompt(role: TaskRole, paths: LedgerPaths): string {
  return [
    "# Factory design",
    "",
    `You help the user write the contract of a factory task. ${taskLine(role, paths)}`,
    "The task is a `sketch`: nothing acts on it before handoff. After handoff, a worker that has only this file does the work. The file must make sense without this conversation.",
    "",
    "- The HTML comments in the file tell what each section needs. Ask the user what you cannot find out yourself, a few questions at a time.",
    "- Write into the file as the conversation goes. Replace each comment with real text. Edit the prose with your edit tools. Change the title with `factory_task` `update`.",
    "- When the user says that the task is ready, run `factory_handoff`. When it fails, tell the user what is missing.",
    "- Do not do the task yourself.",
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
  return { factory_worker: `${await prompt("WORKER.md")}\n\n${taskLine(role, paths)}` };
}

async function designSections(role: TaskRole, paths: LedgerPaths): Promise<Sections> {
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
 * reads the files each time, so a change to `COORDINATOR.md` applies at the next turn.
 */
export async function roleSections(role: Role, paths: LedgerPaths): Promise<Sections> {
  if (role.kind === "none") return {};
  return { factory_rules: await prompt("chinchilla.md"), ...(await ownSections(role, paths)) };
}
