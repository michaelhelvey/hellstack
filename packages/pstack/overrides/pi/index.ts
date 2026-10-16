import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAsk } from "./ask.ts";
import { DEPTH_FLAG, defaultSettings, type Settings } from "./config.ts";
import { registerOneShot } from "./one-shot.ts";
import { registerPathSkills } from "./path-skills.ts";
import { registerPromptSections } from "./prompt.ts";
import { registerSchedule, Scheduler } from "./schedule.ts";

// hellstack: this file replaces the upstream index.ts. It does not start the pstack agent runner,
// because the herdr-agents extension of @hellstack/pi supplies the subagents.

/** The environment variable that herdr-agents sets in each subagent. */
const SUBAGENT_ENV = "HELLSTACK_SUBAGENT";

/** There are no pstack agents, so a run never waits for an agent to exit. */
const noAgents = { nextExit: () => Promise.resolve() };

export function install(pi: ExtensionAPI, settings: Settings): void {
  const scheduler = new Scheduler(pi);
  const oneShot = registerOneShot(pi, settings, noAgents);
  registerAsk(pi, oneShot);
  registerSchedule(pi, scheduler, oneShot);
  registerPromptSections(pi, settings);
  registerPathSkills(pi, settings);
  pi.on("session_shutdown", () => {
    oneShot.dispose();
    scheduler.stopAll();
  });
}

/** A herdr subagent is one layer below the main session, so it gets the sheet but not the mandate. */
function readDepth(pi: ExtensionAPI): number {
  if (process.env[SUBAGENT_ENV] === "1") return 1;
  return Number(pi.getFlag(DEPTH_FLAG)) || 0;
}

export default function pstack(pi: ExtensionAPI): void {
  pi.registerFlag(DEPTH_FLAG, { type: "string", description: "Layers below the main session." });
  install(
    pi,
    defaultSettings(() => readDepth(pi)),
  );
}
