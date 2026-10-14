/**
 * The environment variable that holds the names of the unlocked skills, separated by commas.
 * `smart-skills` sets it, and `herdr-agents` gives it to each subagent.
 */
export const SKILLS_ENV = "HELLSTACK_SKILLS";

/** Reads the skill names from `SKILLS_ENV`. Returns an empty list if it is not set. */
export function readSkillsEnv(): string[] {
  return (process.env[SKILLS_ENV] ?? "").split(",").filter((name) => name !== "");
}

/** Writes the skill names to `SKILLS_ENV`. */
export function writeSkillsEnv(names: Iterable<string>): void {
  process.env[SKILLS_ENV] = [...names].join(",");
}
