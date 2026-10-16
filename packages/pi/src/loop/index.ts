import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import { MAX_DELAY_S, MIN_DELAY_S, Scheduler } from "./scheduler.ts";

/** The longest interval of a loop. `setInterval` treats a longer delay as 1 ms. */
const MAX_LOOP_S = 24 * 86400;

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

const usage = "Usage: /loop [interval like 5m or 1h] <prompt>, or /loop stop";

/** A parsed `/loop` command. */
export type LoopCommand =
  | { kind: "stop" }
  | { kind: "usage"; reason?: string }
  | { kind: "fixed"; seconds: number; prompt: string }
  | { kind: "selfPaced"; prompt: string };

const WakeupParams = Type.Object({
  delaySeconds: Type.Optional(
    Type.Number({ description: `Seconds until the wakeup (${MIN_DELAY_S}-${MAX_DELAY_S})` }),
  ),
  prompt: Type.Optional(Type.String({ description: "The prompt to run when the wakeup fires" })),
  reason: Type.Optional(Type.String({ description: "Why this delay, in one short sentence" })),
  stop: Type.Optional(Type.Boolean({ description: "Cancel the pending wakeup" })),
});

function parseInterval(text: string): LoopCommand | undefined {
  const match = /^(\d+)([smhd])(?:\s+([\s\S]+))?$/.exec(text);
  if (!match) return undefined;
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2]!]!;
  if (!match[3]) return { kind: "usage" };
  if (seconds > MAX_LOOP_S) return { kind: "usage", reason: "The longest interval is 24 days." };
  return { kind: "fixed", seconds: Math.max(MIN_DELAY_S, seconds), prompt: match[3].trim() };
}

const keywords: Record<string, LoopCommand> = { "": { kind: "usage" }, stop: { kind: "stop" } };

/** Parses the arguments of the `/loop` command. */
export function parseLoop(args: string): LoopCommand {
  const text = args.trim();
  const command = keywords[text] || parseInterval(text);
  return command || { kind: "selfPaced", prompt: text };
}

function selfPacedPrompt(prompt: string): string {
  return `${prompt}\n\n[/loop, self-paced] When this iteration is done, call schedule_wakeup with prompt "/loop ${prompt}" and a delay that fits what you wait for (${MIN_DELAY_S} to ${MAX_DELAY_S} seconds). Do not call it to end the loop.`;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: {} };
}

type WakeupRequest = Static<typeof WakeupParams>;

function wakeup(scheduler: Scheduler, params: WakeupRequest, ctx: { isIdle(): boolean }) {
  if (params.stop) return text(scheduler.requestCancel());
  if (params.delaySeconds === undefined || !params.prompt)
    throw new Error("schedule_wakeup needs delaySeconds and prompt, or stop: true.");
  const seconds = Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, Math.round(params.delaySeconds)));
  return text(scheduler.requestWakeup(seconds, params.prompt, ctx));
}

function start(scheduler: Scheduler, prompt: string, ctx: ExtensionCommandContext): void {
  if (ctx.isIdle()) return scheduler.fire(prompt);
  scheduler.scheduleWakeup(0, prompt, ctx);
  ctx.ui.notify("The loop starts when the session is idle.", "info");
}

type Running = Extract<LoopCommand, { prompt: string }>;

function startLoop(scheduler: Scheduler, command: Running, ctx: ExtensionCommandContext): void {
  if (command.kind === "fixed") {
    scheduler.startLoop(command.seconds, command.prompt, ctx);
    return start(scheduler, command.prompt, ctx);
  }
  scheduler.startSelfPaced();
  start(scheduler, selfPacedPrompt(command.prompt), ctx);
}

function runLoop(scheduler: Scheduler, command: LoopCommand, ctx: ExtensionCommandContext): void {
  if (command.kind === "usage") return ctx.ui.notify(`${command.reason ?? ""} ${usage}`, "info");
  const stopped = scheduler.stopAll();
  if (command.kind !== "stop") return startLoop(scheduler, command, ctx);
  ctx.ui.notify(stopped ? "Loop stopped." : "No loop.", "info");
}

/** Adds the `schedule_wakeup` tool and the `/loop` command. */
export default function loop(pi: ExtensionAPI): void {
  const scheduler = new Scheduler((prompt, options) => pi.sendUserMessage(prompt, options));
  pi.registerTool({
    name: "schedule_wakeup",
    label: "Schedule wakeup",
    exposure: "model-only",
    description: `Run a prompt in this session after delaySeconds (${MIN_DELAY_S}-${MAX_DELAY_S}), when the session is idle. One wakeup is pending at a time: a new call replaces it, and stop: true cancels it. A self-paced /loop uses it.`,
    parameters: WakeupParams,
    execute: (_id, params, _signal, _onUpdate, ctx) =>
      Promise.resolve(wakeup(scheduler, params, ctx)),
  });
  pi.registerCommand("loop", {
    description: "Run a prompt each interval (/loop 5m <prompt>), self-paced, or stop it",
    handler: (args, ctx) => Promise.resolve(runLoop(scheduler, parseLoop(args), ctx)),
  });
  pi.on("agent_start", () => scheduler.onRunStart());
  pi.on("agent_settled", () => scheduler.onRunSettled());
  pi.on("session_shutdown", () => {
    scheduler.stopAll();
  });
}
