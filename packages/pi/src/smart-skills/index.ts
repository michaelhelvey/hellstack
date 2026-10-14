/**
 * Lets a skill that the user starts with `/skill:name` load the skills that it lists in
 * `metadata.uses`, also if they have `disable-model-invocation: true`.
 */

import type { ExtensionAPI, ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

import { readSkillsEnv, writeSkillsEnv } from "../shared/skills-env.ts";
import { resolveUses } from "./uses.ts";

const ENTRY_TYPE = "smart-skills";

const SKILL_COMMAND = /^\/skill:(\S+)/;

const EntrySchema = z.object({
  type: z.literal("custom"),
  customType: z.literal(ENTRY_TYPE),
  data: z.object({ skills: z.array(z.string()) }),
});

function restoreBranch(ctx: ExtensionContext): string[] {
  return ctx.sessionManager
    .getBranch()
    .flatMap((entry) => EntrySchema.safeParse(entry).data?.data.skills ?? []);
}

/** Keeps the unlocked skills of the session, and shows them to the model. */
class SmartSkills {
  #unlocked = new Set<string>();
  /** The skills that the user started since the last agent run. */
  readonly #started = new Set<string>();

  constructor(private readonly pi: ExtensionAPI) {}

  restore(ctx: ExtensionContext): void {
    this.#unlocked = new Set(restoreBranch(ctx));
    this.#started.clear();
    this.#add(readSkillsEnv());
  }

  start(text: string): void {
    const name = SKILL_COMMAND.exec(text)?.[1];

    if (name !== undefined) this.#started.add(name);
  }

  async apply(skills: Skill[]): Promise<void> {
    this.#add(await resolveUses([...this.#started], skills));
    this.#started.clear();

    for (const skill of skills) {
      if (this.#unlocked.has(skill.name)) skill.disableModelInvocation = false;
    }
  }

  #add(names: Iterable<string>): void {
    const added = [...names].filter((name) => !this.#unlocked.has(name));

    for (const name of added) this.#unlocked.add(name);
    if (added.length > 0) this.pi.appendEntry(ENTRY_TYPE, { skills: added });
    writeSkillsEnv(this.#unlocked);
  }
}

/**
 * Unlocks a skill and the skills in its `metadata.uses` (also through other skills) when the user
 * starts it with `/skill:name`. Unlocked skills show in the system prompt until the session ends.
 */
export default function smartSkills(pi: ExtensionAPI): void {
  const state = new SmartSkills(pi);

  pi.on("session_start", (_event, ctx) => state.restore(ctx));
  pi.on("session_tree", (_event, ctx) => state.restore(ctx));
  pi.on("input", (event) => state.start(event.text));
  pi.on("before_agent_start", (event) => state.apply(event.systemPromptOptions.skills));
}
