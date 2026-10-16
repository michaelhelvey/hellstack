// @amp-agent-mode {"key":"chinchilla-low","label":"chinchilla-low"}
// @amp-agent-mode {"key":"chinchilla-medium","label":"chinchilla-medium"}
// @amp-agent-mode {"key":"chinchilla-high","label":"chinchilla-high"}
// @amp-agent-mode {"key":"chinchilla-ultra","label":"chinchilla-ultra"}

import { join } from "node:path";
import type {
  AgentReasoningEffort,
  BuiltinAgentMode,
  PluginAgentModel,
  PluginAPI,
} from "@ampcode/plugin";

/** A model and a reasoning effort that the model supports. */
export interface Pin {
  model: PluginAgentModel;
  effort: AgentReasoningEffort;
}

/** A built-in mode with the chinchilla voice and pstack, with each role pinned to one model. */
export interface ChinchillaMode {
  key: string;
  extends: BuiltinAgentMode;
  agent: Pin;
  oracle: Pin;
  subagents: Pin;
  description: string;
}

const qwen: Pin = { model: "alibaba/qwen3.8-max", effort: "xhigh" };
const deepseek: Pin = { model: "deepseek/deepseek-v4.1-flash", effort: "high" };
const deepseekSubagents: Pin = { model: "deepseek/deepseek-v4.1-flash", effort: "max" };

/**
 * The chinchilla modes. The models are the same as the Tune Modes pins of the built-in modes,
 * because Tune Modes does not change a plugin mode. Each role sets an effort, because a plugin mode
 * fails when its model does not support the effort of the built-in mode.
 */
export const chinchillaModes: ChinchillaMode[] = [
  {
    key: "chinchilla-low",
    extends: "low",
    agent: deepseek,
    oracle: qwen,
    subagents: deepseekSubagents,
    description: "low with the chinchilla voice and pstack. Use for small, well-defined tasks.",
  },
  {
    key: "chinchilla-medium",
    extends: "medium",
    agent: { model: "zhipuai/glm-5.3", effort: "max" },
    oracle: qwen,
    subagents: deepseekSubagents,
    description: "medium with the chinchilla voice and pstack. Use for most work.",
  },
  {
    key: "chinchilla-high",
    extends: "high",
    agent: qwen,
    oracle: qwen,
    subagents: deepseekSubagents,
    description:
      "high with the chinchilla voice and pstack. Use for hard tasks where a miss is costly.",
  },
  {
    key: "chinchilla-ultra",
    extends: "ultra",
    agent: { model: "xai/grok-4.7", effort: "xhigh" },
    oracle: qwen,
    subagents: deepseekSubagents,
    description:
      "ultra with the chinchilla voice and pstack. Use for open-ended work across many files or systems.",
  },
];

/** The instruction files that each mode adds to the prompt of its built-in mode, in order. */
export const instructionFiles = ["chinchilla.md", "pstack.md"];

async function readInstructions(): Promise<string> {
  const texts = instructionFiles.map((name) => Bun.file(join(import.meta.dir, name)).text());
  return (await Promise.all(texts)).join("\n\n");
}

/** Registers the chinchilla modes. */
export default async function hellstack(amp: PluginAPI): Promise<void> {
  const instructions = await readInstructions();
  for (const mode of chinchillaModes) {
    const agent = amp.createAgent({
      extends: mode.extends,
      model: mode.agent.model,
      reasoningEffort: mode.agent.effort,
      oracle: mode.oracle,
      subagents: mode.subagents,
      instructions,
      display: { label: mode.key, color: "#a8a29e" },
    });
    amp.registerAgentMode({
      key: mode.key,
      description: mode.description,
      agent: agent.definition,
    });
  }
}
