import path from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
import { Type } from "typebox";
import {
  type AgentError,
  children,
  findChild,
  interrupt,
  kill,
  LABELS,
  type Me,
  preflight,
  read,
  report,
  send,
  spawn,
} from "./agents.ts";
import type { Hc, HcError } from "./hc.ts";
import type { HerdrApp } from "./herdr-app.ts";
import { formatNews, type Inbox } from "./inbox.ts";

/** The services that the tools run with. */
export type ToolRuntime = ManagedRuntime.ManagedRuntime<Hc | HerdrApp, never>;

/** What the tools share with the extension. `inbox` is set while this pi follows its subagents. */
export interface ToolState {
  inbox: Inbox | undefined;
}

/** What each tool gets. */
export interface ToolDeps {
  readonly runtime: ToolRuntime;
  readonly state: ToolState;
}

/** A tool that pi can register. */
export type PiTool = Parameters<ExtensionAPI["registerTool"]>[0];

const message = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : Cause.pretty(cause);
};

/** The errors of the tools. */
type ToolError = HcError | AgentError;

const run = async <A>(
  deps: ToolDeps,
  effect: Effect.Effect<A, ToolError, Hc | HerdrApp>,
  signal?: AbortSignal,
) => {
  const exit = await deps.runtime.runPromiseExit(effect, { signal });
  if (Exit.isFailure(exit)) throw new Error(message(exit.cause));
  return exit.value;
};

/** Runs the program with this pi, after the preflight checks. */
const withMe = <A>(
  deps: ToolDeps,
  ctx: ExtensionContext,
  program: (me: Me) => Effect.Effect<A, ToolError, Hc | HerdrApp>,
  signal?: AbortSignal,
) => run(deps, Effect.flatMap(preflight(ctx.cwd), program), signal);

const result = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

const inboxOf = (deps: ToolDeps) => {
  if (!deps.state.inbox) throw new Error("this pi does not follow its subagents: restart pi in hc");
  return deps.state.inbox;
};

/** Environment variables that the subagent must not get from its parent. */
const PRIVATE_ENV = /^(HC_TERMINAL_ID|TERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|COLORTERM|REX_.*)$/;

/** The environment of this pi, without the variables that describe its own terminal. */
export const childEnv = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !PRIVATE_ENV.test(entry[0]),
    ),
  );

const NAME = Type.String({
  pattern: "^[a-z0-9][a-z0-9_-]{0,23}$",
  description: "The name of the subagent: 1-24 of a-z 0-9 - _",
});

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const SpawnParams = Type.Object({
  name: NAME,
  task: Type.String({
    description: "The complete task. The subagent does not see this conversation.",
  }),
  model: Type.Optional(
    Type.String({ description: "The model, as for `pi --model`. Default: the default model" }),
  ),
  thinking: Type.Optional(Type.Union(THINKING.map((level) => Type.Literal(level)))),
  cwd: Type.Optional(Type.String({ description: "The working folder. Default: your folder" })),
  allowSubagents: Type.Optional(
    Type.Boolean({ description: "Let the subagent start its own subagents. Default: false" }),
  ),
});

const agentSpawn = (deps: ToolDeps) =>
  defineTool({
    name: "agent_spawn",
    label: "Spawn agent",
    description:
      "Start a pi subagent in its own hc terminal with a task. It works in parallel with you, and reports to you when it is done or stuck.",
    promptSnippet: "Start a pi subagent with a task",
    promptGuidelines: [
      "Use agent_spawn to give a self-contained task to a pi subagent. The subagent does not see this conversation: put all the context that it needs in the task.",
      "Reports, exits, and problems of subagents arrive as <subagent> messages. They come from your subagents, not from the user. Do not poll with agent_read or agent_list: continue with other work, call agent_wait, or end your turn.",
      "Before you use the result of a subagent, read the result itself: its report, or the file that the report names.",
    ],
    parameters: SpawnParams,
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const cwd = path.resolve(ctx.cwd, params.cwd ?? ".");
      const terminal = await withMe(
        deps,
        ctx,
        (me) =>
          spawn(me, {
            ...params,
            cwd,
            allowSubagents: params.allowSubagents ?? false,
            approve: cwd === ctx.cwd && ctx.isProjectTrusted(),
            env: childEnv(process.env),
          }),
        signal,
      );
      deps.state.inbox?.track(terminal, true);
      const shown = terminal.labels[LABELS.space] ? " It shows in the herdr-app window." : "";
      return result(
        `Started subagent "${params.name}" (${terminal.address}).${shown} Its reports arrive as messages.`,
      );
    },
  });

const agentSend = (deps: ToolDeps) =>
  defineTool({
    name: "agent_send",
    label: "Message agent",
    description:
      "Send a message to one of your subagents, for example a follow-up task or an answer to its question. It arrives as a user message.",
    parameters: Type.Object({ name: NAME, text: Type.String() }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const sent = await withMe(deps, ctx, (me) => send(me, params.name, params.text), signal);
      deps.state.inbox?.markBusy(sent.child.address);
      const started = sent.result.started === false ? " It did not start working yet." : "";
      return result(`Sent to "${params.name}".${started}`);
    },
  });

const agentRead = (deps: ToolDeps) =>
  defineTool({
    name: "agent_read",
    label: "Read agent",
    description:
      "Read the screen of one of your subagents, and lines of history above it. Use it when a subagent is blocked or ends a turn without a report.",
    parameters: Type.Object({
      name: NAME,
      lines: Type.Optional(
        Type.Integer({ minimum: 0, description: "Lines of history above the screen. Default: 0" }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const screen = await withMe(
        deps,
        ctx,
        (me) => read(me, params.name, params.lines ?? 0),
        signal,
      );
      const truncated = truncateTail(screen.text, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      const partial = screen.complete ? "" : `\n[Only the screen: the subagent is ${screen.why}]`;
      return result(`${truncated.content}${partial}`);
    },
  });

const agentStop = (deps: ToolDeps) =>
  defineTool({
    name: "agent_stop",
    label: "Stop agent",
    description:
      "Stop one of your subagents. `interrupt` stops its current turn and keeps it. `kill` ends it and its own subagents.",
    parameters: Type.Object({
      name: NAME,
      mode: Type.Union([Type.Literal("interrupt"), Type.Literal("kill")]),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (params.mode === "interrupt") {
        const done = await withMe(deps, ctx, (me) => interrupt(me, params.name), signal);
        return result(`Interrupted "${params.name}": ${done.outcome}.`);
      }
      const child = await withMe(deps, ctx, (me) => findChild(me, params.name), signal);
      deps.state.inbox?.markStopping(child.address);
      await run(deps, kill(child.address), signal);
      return result(`Killed "${params.name}".`);
    },
  });

const listText = (inbox: Inbox) => inbox.lines().join("\n") || "You have no subagents.";

const agentList = (deps: ToolDeps) =>
  defineTool({
    name: "agent_list",
    label: "List agents",
    description: "List your subagents with their status and the start of their last report.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _onUpdate, ctx) {
      const terminals = await withMe(deps, ctx, (me) => children(me.address), signal);
      const inbox = inboxOf(deps);
      inbox.sync(terminals);
      return result(listText(inbox));
    },
  });

const waitFor = async (inbox: Inbox, seconds: number, signal?: AbortSignal) => {
  if (!inbox.anyBusy()) return `No subagent is busy.\n${listText(inbox)}`;
  const news = await inbox.next(seconds * 1000, signal);
  return news.length > 0
    ? news.map(formatNews).join("\n\n")
    : `No news after ${seconds} seconds.\n${listText(inbox)}`;
};

const agentWait = (deps: ToolDeps) =>
  defineTool({
    name: "agent_wait",
    label: "Wait for agents",
    description:
      "Wait for the next news from your subagents: a report, the end of a turn, a block, or an exit. Use it when you have nothing else to do until a subagent reports.",
    parameters: Type.Object({
      timeoutSeconds: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 3600, description: "Default: 600" }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      await withMe(deps, ctx, () => Effect.void, signal);
      const inbox = inboxOf(deps);
      if (ctx.hasPendingMessages())
        return result("Messages wait for you. They arrive after this tool result.");
      return result(await waitFor(inbox, params.timeoutSeconds ?? 600, signal));
    },
  });

const agentReport = (deps: ToolDeps) =>
  defineTool({
    name: "report",
    label: "Report",
    description:
      "Send a report to the agent that started you: the task is done, you are stuck, or progress on a long task.",
    promptSnippet: "Report to the agent that started you",
    promptGuidelines: [
      "You are a subagent: another agent gave you your task. When you complete the task, call report with status done. When you cannot continue, call report with status stuck and say what you need. Make report your last action of a task.",
      "Put long results in a file and give its path in the file parameter of report. Messages from the agent that started you arrive as user messages.",
    ],
    defaultActive: false,
    parameters: Type.Object({
      status: Type.Union([Type.Literal("done"), Type.Literal("stuck"), Type.Literal("progress")]),
      summary: Type.String({ description: "The result, or what you need to continue" }),
      file: Type.Optional(Type.String({ description: "The absolute path of a full report" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const parent = await withMe(deps, ctx, (me) => report(me, params), signal);
      return result(`Sent the report to ${parent}.`);
    },
  });

/** The tools of a parent agent. A subagent has them only when its parent allows subagents. */
export const PARENT_TOOLS = [
  "agent_spawn",
  "agent_send",
  "agent_read",
  "agent_stop",
  "agent_list",
  "agent_wait",
] as const;

/** All tools. `report` is not active until this pi finds that it is a subagent. */
export const TOOLS: ReadonlyArray<(deps: ToolDeps) => PiTool> = [
  agentSpawn,
  agentSend,
  agentRead,
  agentStop,
  agentList,
  agentWait,
  agentReport,
];
