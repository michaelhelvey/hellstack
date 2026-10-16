import { z } from "zod";

import { type ChinchillaMode, chinchillaModes, type Pin } from "../plugin/hellstack/index.ts";
import { run } from "./git.ts";

const agentOptionsSchema = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      capabilities: z.object({ efforts: z.array(z.string()).optional() }),
    }),
  ),
});

/** The reasoning efforts that each plugin agent model supports, by model ID. */
export type ModelEfforts = Map<string, string[]>;

/** Reads the models and efforts for plugin agents from `amp plugins show-agent-options`. */
export async function readModelEfforts(): Promise<ModelEfforts> {
  const output = await run(["amp", "plugins", "show-agent-options", "--json"]);
  const { models } = agentOptionsSchema.parse(JSON.parse(output));
  return new Map(models.map((model) => [model.id, model.capabilities.efforts ?? []]));
}

function pinProblem(role: string, pin: Pin, efforts: ModelEfforts): string | undefined {
  const supported = efforts.get(pin.model);
  if (supported === undefined) return `${role}: Amp has no plugin agent model ${pin.model}`;
  if (supported.includes(pin.effort)) return undefined;
  return `${role}: ${pin.model} does not support effort ${pin.effort} (it supports ${supported.join(", ")})`;
}

/** Returns one line for each pin of the modes that names an unknown model or effort. */
export function pinProblems(
  efforts: ModelEfforts,
  modes: ChinchillaMode[] = chinchillaModes,
): string[] {
  return modes.flatMap((mode) =>
    (["agent", "oracle", "subagents"] as const).flatMap(
      (role) => pinProblem(`${mode.key} ${role}`, mode[role], efforts) ?? [],
    ),
  );
}
