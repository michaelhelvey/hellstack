import {
  defineTool,
  type ExtensionAPI,
  type ToolAnnotations,
  type ToolNamespace,
} from "@earendil-works/pi-coding-agent";
import { Cause, Effect, Exit, type ManagedRuntime, Schema } from "effect";
import { type Static, type TSchema, Type } from "typebox";
import type { Atlassian, AtlassianError } from "../atlassian.ts";

/** A schema for a value that can be null. */
export const Nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);

/** Makes all properties and arrays of a type readonly, so that readonly domain values fit it. */
export type Immutable<T> =
  T extends ReadonlyArray<infer U>
    ? ReadonlyArray<Immutable<U>>
    : T extends object
      ? { readonly [K in keyof T]: Immutable<T[K]> }
      : T;

/** The namespace of the tools. Scripts find the tools with `describeNamespace("jira")`. */
export const NAMESPACE: ToolNamespace = {
  name: "jira",
  aliases: ["confluence", "atlassian"],
  description:
    "Jira and Confluence on Atlassian Cloud: issues, boards, sprints, time tracking, operations epics, weekly KPIs, and Confluence pages.",
  instructions: [
    "Call these tools from codemode scripts. Each tool resolves to its structured result.",
    "Searches and board lists do not include Accounted and Removed issues unless `includeHidden` is true.",
    "The tools refuse to set Business Category, Operations Category, Complete Work Sprint, and CWIP fields, and refuse to move issues to Accounted.",
    "Each issue result has a `url`. Give it to the user for each issue that you create or change.",
    "Use `jira_request` for a REST API call that no other tool does. Its path is relative to the site, for example `/rest/api/3/myself` or `/wiki/api/v2/pages/123`.",
  ].join("\n"),
};

/** The services that the tools run with. */
export type ToolRuntime = ManagedRuntime.ManagedRuntime<Atlassian, never>;

/** A Jira tool: its parameters, its result schema, and the program that makes the result. */
export interface JiraTool<P extends TSchema, O extends TSchema> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: P;
  readonly output: O;
  /** True for tools that only read data. */
  readonly readOnly: boolean;
  /** True for tools whose changes cannot be undone. */
  readonly destructive?: boolean;
  readonly run: (
    params: Static<P>,
  ) => Effect.Effect<Immutable<Static<O>>, AtlassianError, Atlassian>;
}

const toJson = Schema.decodeUnknownSync(Schema.Json);

const message = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : Cause.pretty(cause);
};

const annotations = (tool: {
  readonly readOnly: boolean;
  readonly destructive?: boolean;
}): ToolAnnotations => ({
  readOnlyHint: tool.readOnly,
  destructiveHint: tool.destructive === true,
  openWorldHint: true,
});

/** A tool that pi can register. */
export type PiTool = Parameters<ExtensionAPI["registerTool"]>[0];

/** Makes a pi tool that runs with the given services. */
export type ToolFactory = (runtime: ToolRuntime) => PiTool;

/**
 * Makes a pi tool factory from a Jira tool. The tool has `deferred` exposure: the model does not
 * see it, and codemode scripts call it by name.
 */
export const jiraTool =
  <P extends TSchema, O extends TSchema>(tool: JiraTool<P, O>): ToolFactory =>
  (runtime) =>
    defineTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      outputSchema: tool.output,
      exposure: "deferred",
      namespace: NAMESPACE,
      annotations: annotations(tool),
      async execute(_toolCallId, params, signal) {
        const exit = await runtime.runPromiseExit(tool.run(params), { signal });
        if (Exit.isFailure(exit)) throw new Error(message(exit.cause));
        const result = toJson(exit.value);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          details: undefined,
        };
      },
    });
