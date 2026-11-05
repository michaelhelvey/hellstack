import type {
  AgentToolResult,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";

/** A tool function that uses only the parameters, the context, and the abort signal of a call. */
export type ToolRun<TParams extends TSchema, TDetails> = (
  params: Static<TParams>,
  ctx: ExtensionToolContext,
  signal: AbortSignal | undefined,
) => Promise<AgentToolResult<TDetails>>;

/**
 * Makes the `execute` function of a pi tool from `run`. The function ignores the tool call ID and
 * the update callback. `parameters` is the parameter schema of the tool. TypeScript uses it to get
 * the type of the parameters of `run`.
 */
export function toolExecute<TParams extends TSchema, TDetails>(
  _parameters: TParams,
  run: ToolRun<TParams, TDetails>,
): ToolDefinition<TParams, TDetails>["execute"] {
  return (_toolCallId, params, signal, _onUpdate, ctx) => {
    // #lizard forgives: pi sets the five parameters of `execute`.
    return run(params, ctx, signal);
  };
}
