import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { HerdrClient, herdrEnv } from "./herdr/client.ts";
import { SUBAGENT_ENV } from "../shared/subagent.ts";
import { HerdrSubagentProvider } from "./herdr/provider.ts";
import { AwaitedAgents, CompletionNotifier, REPORT_MESSAGE_TYPE } from "./notify.ts";
import type { SubagentProvider } from "./provider.ts";
import { RexClient, rexEnv } from "./rex/client.ts";
import { RexSubagentProvider } from "./rex/provider.ts";
import { describeAgent, registerSubagentTools } from "./tools.ts";
import { AgentsWidget } from "./ui/widget.ts";

const WIDGET_KEY = "herdr-agents";

/** The error when pi does not run in a herdr pane or a Rex terminal. */
export const NO_PANES =
  "Subagents need herdr or Rex. Start pi in a herdr pane or a Rex terminal to use subagents (HERDR_ENV and REX_SESSION are not set).";

/** A provider that can stop its event connections and leave its subagents to run. */
type PaneProvider = SubagentProvider & { release(): void };

/** Returns a provider for the terminal multiplexer that pi runs in, or `undefined` for none. */
function paneProvider(ctx: ExtensionContext): PaneProvider | undefined {
  const herdr = herdrEnv();

  if (herdr) {
    const client = new HerdrClient(herdr.socketPath);

    return new HerdrSubagentProvider({ env: herdr, client, cwd: ctx.cwd });
  }
  const rex = rexEnv();

  if (rex === undefined) return undefined;
  const client = new RexClient(rex.sessionId);
  const sessionDir =
    ctx.sessionManager.getSessionDir() || path.join(tmpdir(), "hellstack-subagent-sessions");

  return new RexSubagentProvider({ client, cwd: ctx.cwd, sessionDir });
}

async function stopAgents(provider: SubagentProvider, id: string): Promise<void> {
  const ids = id === "" || id === "all" ? provider.list().map((agent) => agent.id) : [id];
  await Promise.all(ids.map((agentId) => provider.stop(agentId)));
}

function listAgents(provider: SubagentProvider, ctx: ExtensionCommandContext): void {
  const lines = provider.list().map(describeAgent);
  ctx.ui.notify(lines.length === 0 ? "No subagents." : lines.join("\n"), "info");
}

async function command(
  provider: SubagentProvider | undefined,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (provider === undefined) return ctx.ui.notify(NO_PANES, "error");
  const [name = "", rest = ""] = args.trim().split(/\s+(.*)/s);

  if (name === "stop") await stopAgents(provider, rest.trim());
  else listAgents(provider, ctx);
}

/**
 * Runs subagents as pi agents in herdr panes or Rex terminals, and shows them above the editor.
 * Adds the `subagent_*` tools and the `/agents` command. In a subagent, it does nothing, so that
 * subagents cannot start subagents.
 */
export default function herdrAgents(pi: ExtensionAPI): void {
  if (process.env[SUBAGENT_ENV] === "1") return;
  const awaited = new AwaitedAgents();
  let provider: PaneProvider | undefined;
  let notifier: CompletionNotifier | undefined;

  function report(content: string): void {
    const message = { customType: REPORT_MESSAGE_TYPE, content, display: true };
    pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" });
  }

  pi.on("session_start", (_event, ctx) => {
    const current = paneProvider(ctx);

    if (current === undefined) return;
    provider = current;
    notifier = new CompletionNotifier({ provider: current, awaited, send: report });

    if (ctx.hasUI) {
      ctx.ui.setWidget(
        WIDGET_KEY,
        (tui, theme) => new AgentsWidget({ provider: current, tui, theme }),
      );
    }
  });

  pi.on("session_shutdown", async (event) => {
    notifier?.dispose();
    notifier = undefined;

    if (event.reason === "reload") provider?.release();
    else await provider?.dispose();
    provider = undefined;
  });

  registerSubagentTools(
    pi,
    () => {
      if (provider === undefined) throw new Error(NO_PANES);

      return provider;
    },
    awaited,
  );

  pi.registerCommand("agents", {
    description: "List the subagents. `stop [id|all]` stops them",
    getArgumentCompletions: (prefix) =>
      "stop".startsWith(prefix) ? [{ value: "stop", label: "stop" }] : [],
    handler: (args, ctx) => command(provider, args, ctx),
  });
}
