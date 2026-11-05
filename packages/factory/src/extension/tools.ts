import { defineTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";

import { ledgerPaths } from "../core/paths.ts";
import { runDispatch, runHandoff, runInboxAction, runTaskAction } from "./actions.ts";
import type { Role } from "./role.ts";
import {
  dispatchParamsSchema,
  handoffParamsSchema,
  inboxParamsSchema,
  taskParamsSchema,
} from "./schemas.ts";

/** The names of the factory tools. */
export const TOOL_NAMES = [
  "factory_task",
  "factory_inbox",
  "factory_dispatch",
  "factory_handoff",
] as const;

/** The name of a factory tool. */
export type ToolName = (typeof TOOL_NAMES)[number];

/** The factory tools of each role. */
export const ROLE_TOOLS: Record<Role["kind"], readonly ToolName[]> = {
  none: [],
  subagent: [],
  coordinator: TOOL_NAMES,
  worker: ["factory_task"],
  design: ["factory_task", "factory_handoff"],
};

/** A tool definition that pi can register. */
export type FactoryTool = ReturnType<typeof defineTool>;

interface ToolSpec<T extends TSchema> {
  name: ToolName;
  label: string;
  description: string;
  parameters: T;
  run: (params: Static<T>) => Promise<string>;
}

/**
 * Makes a factory tool. The tools read and write task files that the agent also changes with its
 * edit tools, so they are `sequential`: pi then does not run other tool calls at the same time.
 */
function makeTool<T extends TSchema>(spec: ToolSpec<T>): FactoryTool {
  return defineTool<T, undefined>({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    executionMode: "sequential",
    execute: async (_id, params): Promise<AgentToolResult<undefined>> => ({
      content: [{ type: "text", text: await spec.run(params) }],
      details: undefined,
    }),
  });
}

const builders: Record<ToolName, (getRole: () => Role) => FactoryTool> = {
  factory_task: (getRole) =>
    makeTool({
      name: "factory_task",
      label: "Factory task",
      description:
        "Read and change factory task files: list, get, create, update (status, now, needs_you, threads, paused, title), log, check. Edit the prose sections of a task file with the edit tools; change the front matter and the Log only with this tool. A worker acts only on its own task.",
      parameters: taskParamsSchema,
      run: (params) => runTaskAction({ role: getRole(), paths: ledgerPaths() }, params),
    }),
  factory_inbox: () =>
    makeTool({
      name: "factory_inbox",
      label: "Factory inbox",
      description: "List the events that no factory task owns, or dismiss one of them.",
      parameters: inboxParamsSchema,
      run: (params) => runInboxAction(ledgerPaths(), params),
    }),
  factory_dispatch: () =>
    makeTool({
      name: "factory_dispatch",
      label: "Factory dispatch",
      description:
        "Start the worker of a ready factory task in its own terminal and set the task to working.",
      parameters: dispatchParamsSchema,
      run: (params) => runDispatch(ledgerPaths(), params.id),
    }),
  factory_handoff: (getRole) =>
    makeTool({
      name: "factory_handoff",
      label: "Factory handoff",
      description:
        "Move a factory sketch to ready. It fails and names the missing parts unless Goal, Verification, Output, and Constraints have text, Landing has checkbox items, and repo is a folder.",
      parameters: handoffParamsSchema,
      run: (params) => runHandoff({ role: getRole(), paths: ledgerPaths() }, params.id),
    }),
};

/** Returns the definition of factory tool `name`. The tool reads the session role at each call. */
export function createTool(name: ToolName, getRole: () => Role): FactoryTool {
  return builders[name](getRole);
}
