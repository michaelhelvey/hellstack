import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Exit, Fiber, Layer, ManagedRuntime } from "effect";
import { canSpawn, isChild, type Me, preflight, showsAtStart, spaceFor } from "./agents.ts";
import { Hc } from "./hc.ts";
import { HerdrApp } from "./herdr-app.ts";
import { formatNews, Inbox, type News } from "./inbox.ts";
import { PARENT_TOOLS, TOOLS, type ToolState } from "./tools.ts";
import { watch } from "./watch.ts";

/** The custom message type of news from subagents. */
export const NEWS_TYPE = "hellstack-subagent";

/** The live services: the `hc` and `herdr-app` binaries. */
export const liveLayer = Layer.mergeAll(Hc.layer, HerdrApp.layer);

/** Activates `report` for a subagent, and removes the parent tools when it cannot spawn. */
const activate = (pi: ExtensionAPI, me: Me) => {
  const active = new Set(pi.getActiveTools());
  if (isChild(me)) active.add("report");
  if (!canSpawn(me)) for (const name of PARENT_TOOLS) active.delete(name);
  pi.setActiveTools([...active]);
};

const deliver = (pi: ExtensionAPI) => (news: News) =>
  pi.sendMessage(
    { customType: NEWS_TYPE, content: formatNews(news), display: true, details: news },
    { deliverAs: "steer", triggerTurn: true },
  );

const drawWidget = (ctx: ExtensionContext, inbox: Inbox) => () => {
  const lines = inbox.lines();
  if (ctx.hasUI) ctx.ui.setWidget(NEWS_TYPE, lines.length > 0 ? lines : undefined);
};

/**
 * Adds tools that start and control pi subagents in herdr-core (`hc`) terminals. Subagents show
 * in the herdr-app window, in one space for the folder of the top agent. A top agent with the label
 * `hellstack.show=1` shows in the window from its start. Reports and other news
 * from subagents arrive as `hellstack-subagent` messages. The tools need pi to run in an hc
 * terminal: without one, they fail.
 */
export default function herdr(pi: ExtensionAPI, layer = liveLayer) {
  const runtime = ManagedRuntime.make(layer);
  const state: ToolState = { inbox: undefined };
  let watcher: Fiber.Fiber<unknown, unknown> | undefined;
  for (const tool of TOOLS) pi.registerTool(tool({ runtime, state }));

  pi.on("session_start", async (_event, ctx) => {
    const exit = await runtime.runPromiseExit(preflight(ctx.cwd));
    if (Exit.isFailure(exit)) return;
    activate(pi, exit.value);
    if (!canSpawn(exit.value)) return;
    const inbox: Inbox = new Inbox(exit.value.address, deliver(pi), () => draw());
    const draw = drawWidget(ctx, inbox);
    state.inbox = inbox;
    watcher = runtime.runFork(watch(inbox));
    if (showsAtStart(exit.value)) runtime.runFork(spaceFor(exit.value));
  });

  pi.on("session_shutdown", async () => {
    state.inbox = undefined;
    if (watcher) await runtime.runPromise(Fiber.interrupt(watcher));
    watcher = undefined;
  });
}
