import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { skillDir } from "@hellstack/skills";

/** A terminal multiplexer that pi can run in. The name is also the name of its skill. */
export type Multiplexer = "herdr" | "rex";

/**
 * Returns the multiplexer that pi runs in, from the environment. herdr-core sets `HC_TERMINAL_ID`
 * in each terminal that it runs. A herdr terminal in a Rex terminal gets the variables of both, so
 * herdr has priority.
 */
export function detectMultiplexer(env: NodeJS.ProcessEnv = process.env): Multiplexer | undefined {
  if (env.HC_TERMINAL_ID) return "herdr";
  if (env.REX_SESSION) return "rex";
  return undefined;
}

/** Returns the system prompt section for a Rex session. */
function rexSection(): string {
  return [
    "You run in a rex pane. Other agents can run in other rex panes on this machine.",
    "Load the `rex` skill and use the `rex` CLI to find, start, talk to, and stop other agents.",
    "",
    "- Read the current state from `rex` each time. Do not keep a list of agents in memory.",
    "- When the user tells you about an agent by its task, find its pane: read the tab and pane names and the pane output.",
    "- Before you start an agent, look for an agent that already does that task.",
    "- Give each tab and pane that you make a name that tells its task, so that other agents can find it.",
    "- When you do not need an agent, tab, or pane that you made, close it immediately.",
    "- Prioritize human readability in how you organize panes.  e.g. a grid layout is more readable than 6 horizontal splits stacked on top of each other.",
    "- Don't redirect output of a pane such that I can't see what the agent is doing myself.",
  ].join("\n");
}

/**
 * Returns the system prompt section for a herdr-core terminal. It sends the agent to the thin
 * `herdr` skill for the commands of the installed `hc` and `herdr-app` versions, and gives the
 * delegation rules that apply before the skill runs.
 */
function herdrSection(): string {
  return [
    "You run in a Herdr terminal (herdr-core). Other agents can run in other terminals on this machine and on machines that the user added.",
    "Load the `herdr` skill. Use `hc` to start, watch, message, and wait for agents. Use `herdr-app` only to change what the user sees, or when the user asks for the window, worktrees, layouts, or mods.",
    "",
    "- Read the current state from `hc ls`, `hc get`, and `hc read` each time. Do not keep a list of agents in memory.",
    "- When the user tells you about an agent by its task, find its terminal: read the names, labels, and screen output.",
    "- Before you start an agent, look for a terminal that already does that task.",
    '- Delegate to interactive agents, not one-shot print modes, so that the user can watch and steer them. Put the first task in `hc run`, and tell each child to report with `hc send $HC_TERMINAL_ID "<result or blocker>"` when it is done or stuck.',
    "- Wait with `hc wait --children all` or `hc wait <terminal>`; do not sleep or poll. A timeout is a check-in, not a failure. Read the child output before you summarize it.",
    "- Keep work visible. Do not redirect a terminal's output to a file or a pipe such that the user cannot watch the agent work.",
    "- Show work proactively. Sub-agents stay under you in the Herdr agents list. Read their output, and use `herdr-app do terminal.peek` or `terminal.keep` when a result or status is useful to see. Add panels or mods only when they help the task; do not add gratuitous UI.",
    "- For parallel work, agents that edit disjoint files can share one worktree with exact file ownership. If edits can overlap, or an agent needs an independent branch, give each agent its own git worktree. Both cases need exact file and folder ownership.",
    "- Clean up only the terminals that you started and whose work you accepted: `hc kill <terminal>`, then `hc rm <terminal>`. Do not stop or restart the herdr-core server.",
  ].join("\n");
}

/** Returns the system prompt section that tells the agent how to work with other agents. */
export function multiplexerSection(name: Multiplexer): string {
  return name === "herdr" ? herdrSection() : rexSection();
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
