import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPrompt } from "@hellstack/prompts";

import { SUBAGENT_ENV } from "../shared/subagent.ts";

/** The file in the pi agent directory that maps the pstack roles to models on this machine. */
export const SHEET_FILE = "pstack-models.md";

const noSheet = `This machine has no \`~/.pi/agent/${SHEET_FILE}\`, so every role runs on the session model.`;

/** What the sections depend on. */
export interface PromptContext {
  /** True in a herdr subagent. A subagent does not get the poteto-mode mandate. */
  subagent: boolean;
  /** The text of the pstack models sheet, if this machine has one. */
  sheet: string | undefined;
  /** True when pi loads the pstack skills. Without them, the prompt has no pstack section. */
  pstack: boolean;
}

function readLocal(file: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
}

/** Returns the system prompt sections of hellstack, by name. */
export function promptSections(context: PromptContext): Record<string, string> {
  const mandate = context.subagent ? [] : [readPrompt("pstack")];
  const sections = {
    instructions: [readPrompt("instructions"), readLocal("pi.md")].join("\n"),
    chinchilla: readPrompt("chinchilla"),
  };
  if (!context.pstack) return sections;
  return {
    ...sections,
    pstack: [...mandate, readLocal("pstack-pi.md"), context.sheet ?? noSheet].join("\n"),
  };
}

function readSheet(): string | undefined {
  try {
    return readFileSync(join(getAgentDir(), SHEET_FILE), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Adds the global instructions, the chinchilla voice, and pstack to the system prompt. It sets them
 * again at each agent start, so that compaction does not remove them.
 */
export default function prompts(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const context = {
      subagent: process.env[SUBAGENT_ENV] === "1",
      sheet: readSheet(),
      pstack:
        event.systemPromptOptions.skills?.some((skill) => skill.name === "poteto-mode") ?? false,
    };
    Object.assign(event.systemPromptOptions.sections, promptSections(context));
  });
}
