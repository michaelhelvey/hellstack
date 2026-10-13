import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { HerdrClient, herdrEnv } from "./herdr/client.ts";
import { HerdrSubagentProvider, SUBAGENT_ENV } from "./herdr/provider.ts";
import { describeAgent, registerSubagentTools } from "./tools.ts";
import { AgentsWidget } from "./ui/widget.ts";

const WIDGET_KEY = "herdr-agents";

/** The error when pi does not run in a herdr pane. */
export const NOT_IN_HERDR =
  "Subagents need herdr. Start pi in a herdr pane to use subagents (HERDR_ENV is not set).";

async function stopAgents(provider: HerdrSubagentProvider, id: string): Promise<void> {
  const ids = id === "" || id === "all" ? provider.list().map((agent) => agent.id) : [id];
  await Promise.all(ids.map((agentId) => provider.stop(agentId)));
}

function listAgents(provider: HerdrSubagentProvider, ctx: ExtensionCommandContext): void {
  const lines = provider.list().map(describeAgent);
  ctx.ui.notify(lines.length === 0 ? "No subagents." : lines.join("\n"), "info");
}

async function command(
  provider: HerdrSubagentProvider | undefined,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (provider === undefined) return ctx.ui.notify(NOT_IN_HERDR, "error");
  const [name = "", rest = ""] = args.trim().split(/\s+(.*)/s);

  if (name === "stop") await stopAgents(provider, rest.trim());
  else listAgents(provider, ctx);
}

/**
 * Runs subagents as pi agents in herdr panes, and shows them above the editor. Adds the
 * `subagent_*` tools and the `/agents` command. In a subagent, it does nothing, so that subagents
 * cannot start subagents.
 */
export default function herdrAgents(pi: ExtensionAPI): void {
  if (process.env[SUBAGENT_ENV] === "1") return;
  const env = herdrEnv();
  let provider: HerdrSubagentProvider | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (env === undefined) return;

    const current = new HerdrSubagentProvider({
      env,
      client: new HerdrClient(env.socketPath),
      cwd: ctx.cwd,
    });

    provider = current;

    if (ctx.hasUI) {
      ctx.ui.setWidget(
        WIDGET_KEY,
        (tui, theme) => new AgentsWidget({ provider: current, tui, theme }),
      );
    }
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason === "reload") provider?.release();
    else await provider?.dispose();
    provider = undefined;
  });

  registerSubagentTools(pi, () => {
    if (provider === undefined) throw new Error(NOT_IN_HERDR);

    return provider;
  });

  pi.registerCommand("agents", {
    description: "List the subagents. `stop [id|all]` stops them",
    getArgumentCompletions: (prefix) =>
      "stop".startsWith(prefix) ? [{ value: "stop", label: "stop" }] : [],
    handler: (args, ctx) => command(provider, args, ctx),
  });
}
