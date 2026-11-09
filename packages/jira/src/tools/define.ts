import { Context, type Schema } from "effect";
import { Tool } from "effect/ai";
import { Atlassian, AtlassianError } from "../atlassian.ts";

/** The MCP hints of a tool. Each tool works on the remote Atlassian site, so it is open world. */
export type Hints = Context.Context<never>;

const hints = (readOnly: boolean, destructive: boolean): Hints =>
  Context.make(Tool.Readonly, readOnly).pipe(
    Context.add(Tool.Destructive, destructive),
    Context.add(Tool.OpenWorld, true),
  );

/** The hints of a tool that only reads data. */
export const READS = hints(true, false);

/** The hints of a tool that changes data. The user can undo the change. */
export const WRITES = hints(false, false);

/** The hints of a tool whose changes the user cannot undo. */
export const DESTROYS = hints(false, true);

/**
 * Makes a Jira tool. Its handler uses the `Atlassian` service of the request, and fails with an
 * `AtlassianError`. The MCP server sends the error message to the client.
 *
 * @example
 * ```ts
 * const Whoami = jiraTool("whoami", {
 *   description: "Get the account that the tools use.",
 *   hints: READS,
 *   parameters: Tool.EmptyParams,
 *   success: Schema.Struct({ accountId: Schema.String }),
 * });
 * ```
 */
export const jiraTool = <
  const Name extends string,
  Parameters extends Schema.Constraint,
  Success extends Schema.Constraint,
>(
  name: Name,
  options: {
    readonly description: string;
    readonly hints: Hints;
    readonly parameters: Parameters;
    readonly success: Success;
  },
) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: options.success,
    failure: AtlassianError,
    dependencies: [Atlassian],
  }).annotateMerge(options.hints);
