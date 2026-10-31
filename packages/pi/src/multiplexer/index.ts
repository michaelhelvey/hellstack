import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { skillDir } from "@hellstack/skills";

/** A terminal multiplexer that pi can run in. The name is also the name of its skill and CLI. */
export type Multiplexer = "herdr" | "rex";

/**
 * Returns the multiplexer that pi runs in, from the environment. A herdr pane in a Rex terminal
 * gets the variables of both, so herdr has priority.
 */
export function detectMultiplexer(env: NodeJS.ProcessEnv = process.env): Multiplexer | undefined {
  if (env.HERDR_ENV === "1") return "herdr";
  if (env.REX_SESSION) return "rex";
  return undefined;
}

/** Returns the system prompt section that tells the agent how to work with other agents. */
export function multiplexerSection(name: Multiplexer): string {
  return [
    `You run in a ${name} pane. Other agents can run in other ${name} panes on this machine.`,
    `Load the \`${name}\` skill and use the \`${name}\` CLI to find, start, talk to, and stop other agents.`,
    "",
    `- Read the current state from \`${name}\` each time. Do not keep a list of agents in memory.`,
    "- When the user tells you about an agent by its task, find its pane: read the tab and pane names and the pane output.",
    "- Before you start an agent, look for an agent that already does that task.",
    "- Give each tab and pane that you make a name that tells its task, so that other agents can find it.",
    "- When you do not need an agent, tab, or pane that you made, close it immediately.",
    "- Prioritize human readability in how you organize panes.  e.g. a grid layout is more readable than 6 horizontal splits stacked on top of each other.",
  ].join("\n");
}

/**
 * Loads the skill of the multiplexer that pi runs in, and tells the agent to use it to work with
 * other agents. Outside a multiplexer, it does nothing. The `@hellstack/skills` package does not
 * load these skills itself.
 */
export default function multiplexer(pi: ExtensionAPI): void {
  const name = detectMultiplexer();
  if (name === undefined) return;

  pi.on("resources_discover", () => ({ skillPaths: [skillDir(name)] }));
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.multiplexer = multiplexerSection(name);
  });
}
