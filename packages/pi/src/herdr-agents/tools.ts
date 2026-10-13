import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { AwaitedAgents } from "./notify.ts";
import {
  closesWhenDone,
  type Subagent,
  type SubagentMessage,
  type SubagentProvider,
} from "./provider.ts";

/** Returns the provider, or throws an error that tells the model why there is no provider. */
export type ProviderGetter = () => SubagentProvider;

const DEFAULT_READ_MESSAGES = 6;

function text(value: string): { content: { type: "text"; text: string }[]; details: undefined } {
  return { content: [{ type: "text", text: value }], details: undefined };
}

/** Formats one subagent as a line, for example `reviewer: working (Reviewer, provider/model)`. */
export function describeAgent(agent: Subagent): string {
  return `${agent.id}: ${agent.status} (${agent.title}, ${agent.model})`;
}

function describeMessage(message: SubagentMessage): string {
  const who = message.from === "parent" ? "You" : "Subagent";

  return `### ${who}\n\n${message.text}`;
}

async function lastReply(
  provider: Pick<SubagentProvider, "read">,
  agent: Subagent,
): Promise<string> {
  const readout = await provider.read(agent.id).catch(() => undefined);

  if (readout === undefined) return "\n\nThe subagent stopped.";
  const { messages } = readout;
  const reply = messages.findLast((message) => message.from === "subagent");

  return reply ? `\n\n${reply.text}` : "";
}

/** Formats a subagent and its last reply as a Markdown section. */
export async function agentReport(
  provider: Pick<SubagentProvider, "read">,
  agent: Subagent,
): Promise<string> {
  const closing = closesWhenDone(agent) ? "\n\nThe subagent is done, so it closes now." : "";

  return `## ${describeAgent(agent)}${await lastReply(provider, agent)}${closing}`;
}

function currentModel(model: { provider: string; id: string } | undefined): string {
  if (model === undefined) throw new Error("Give a model as `provider/model`. You have no model.");

  return `${model.provider}/${model.id}`;
}

const StartParams = Type.Object({
  title: Type.String({ description: "A short name for the subagent, for example `Reviewer`." }),
  task: Type.String({
    description:
      "The full first prompt. The subagent does not see your conversation, so include all the context that it needs.",
  }),
  group: Type.String({
    description:
      "One or two words that describe your work, for example `review`. The herdr tab name uses it. Use the same group for related subagents.",
  }),
  model: Type.Optional(
    Type.String({ description: "The model as `provider/model`. The default is your model." }),
  ),
  keep_open: Type.Optional(
    Type.Boolean({
      description:
        "Keep the subagent open after it is done, so that you can send follow-up messages. The default is false: the subagent closes when it is done.",
    }),
  ),
});

function startTool(getProvider: ProviderGetter) {
  return defineTool({
    name: "subagent_start",
    label: "Start subagent",
    description:
      "Start a pi subagent in a herdr pane and give it a task. Returns at once, while the subagent works. Use subagent_wait to get its result.",
    promptGuidelines: [
      "When a subagent stops work, you get a message with its status and last reply, so you do not have to wait or poll. Use subagent_wait only when you cannot continue without the result.",
      "A subagent closes when it is done, after you get its last reply. Set keep_open only when you plan to send follow-up messages, and stop that subagent with subagent_stop when you do not need it anymore.",
    ],
    parameters: StartParams,
    async execute(_id, params, _signal, _update, ctx) {
      const { keep_open: keepOpen, ...spec } = params;
      const model = spec.model ?? currentModel(ctx.model);
      const agent = await getProvider().start({ ...spec, model, keepOpen, cwd: ctx.cwd });

      return text(`Started ${describeAgent(agent)}`);
    },
  });
}

const IdParams = Type.Object({ id: Type.String({ description: "The id of the subagent." }) });

const IdsParams = Type.Object({
  ids: Type.Array(Type.String(), { description: "The ids of the subagents." }),
});

function sendTool(getProvider: ProviderGetter) {
  return defineTool({
    name: "subagent_send",
    label: "Message subagent",
    description:
      "Send a message to a subagent, for example an answer or a follow-up task. Fails when the subagent waits at an approval dialog.",
    parameters: Type.Object({ ...IdParams.properties, message: Type.String() }),
    async execute(_id, params) {
      await getProvider().send(params.id, params.message);

      return text(`Sent the message to ${params.id}.`);
    },
  });
}

function waitTool(getProvider: ProviderGetter, awaited: AwaitedAgents) {
  return defineTool({
    name: "subagent_wait",
    label: "Wait for subagents",
    description:
      "Wait until all the subagents are idle, done, or blocked. Returns the status and the last reply of each subagent.",
    parameters: Type.Object({
      ...IdsParams.properties,
      timeout_seconds: Type.Optional(Type.Number({ description: "The maximum time to wait." })),
    }),
    async execute(_id, params, signal) {
      const provider = getProvider();
      const timeoutMs = params.timeout_seconds ? params.timeout_seconds * 1000 : undefined;

      const parts = await awaited.during(params.ids, async () => {
        const agents = await Promise.all(
          params.ids.map((id) => provider.wait(id, { timeoutMs, signal })),
        );

        return Promise.all(agents.map((agent) => agentReport(provider, agent)));
      });

      return text(parts.join("\n\n"));
    },
  });
}

function readTool(getProvider: ProviderGetter) {
  return defineTool({
    name: "subagent_read",
    label: "Read subagent",
    description: "Read the status and the last messages of a subagent.",
    parameters: Type.Object({
      ...IdParams.properties,
      last: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: `The number of messages to return. The default is ${DEFAULT_READ_MESSAGES}.`,
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent, messages } = await getProvider().read(params.id);
      const shown = messages.slice(-(params.last ?? DEFAULT_READ_MESSAGES)).map(describeMessage);

      return text([describeAgent(agent), ...shown].join("\n\n"));
    },
  });
}

function listTool(getProvider: ProviderGetter) {
  return defineTool({
    name: "subagent_list",
    label: "List subagents",
    description: "List your subagents and their status.",
    parameters: Type.Object({}),
    execute() {
      const agents = getProvider().list();

      return Promise.resolve(
        text(agents.length === 0 ? "No subagents." : agents.map(describeAgent).join("\n")),
      );
    },
  });
}

function stopTool(getProvider: ProviderGetter) {
  return defineTool({
    name: "subagent_stop",
    label: "Stop subagents",
    description: "Stop subagents and close their herdr panes.",
    parameters: IdsParams,
    async execute(_id, params) {
      const provider = getProvider();
      await Promise.all(params.ids.map((id) => provider.stop(id)));

      return text(`Stopped ${params.ids.join(", ")}.`);
    },
  });
}

/** Adds the subagent tools. */
export function registerSubagentTools(
  pi: ExtensionAPI,
  getProvider: ProviderGetter,
  awaited: AwaitedAgents,
): void {
  for (const make of [startTool, sendTool, readTool, listTool, stopTool]) {
    pi.registerTool(make(getProvider));
  }

  pi.registerTool(waitTool(getProvider, awaited));
}
