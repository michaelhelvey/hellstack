import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { factoryHome, ledgerPaths } from "../core/paths.ts";
import { handoffCommand, parkCommands, sketchCommand, type RoleState } from "./commands.ts";
import { FACTORY_SKILL_DIR, roleSections } from "./prompt.ts";
import { resolveRole, roleFromEnv, type Role } from "./role.ts";
import { createTools, ROLE_TOOLS, TOOL_NAMES } from "./tools.ts";

/** The longest time in seconds that a bash command of the coordinator can run. */
export const COORDINATOR_BASH_LIMIT = 10;

/** Sets the timeout of a bash call to at most {@link COORDINATOR_BASH_LIMIT} seconds. */
export function capBashTimeout(input: { timeout?: number }): void {
  input.timeout = Math.min(input.timeout ?? COORDINATOR_BASH_LIMIT, COORDINATOR_BASH_LIMIT);
}

function isFactoryTool(name: string): boolean {
  return TOOL_NAMES.some((tool) => tool === name);
}

function activateRoleTools(pi: ExtensionAPI, role: Role): void {
  const others = pi.getActiveTools().filter((name) => !isFactoryTool(name));
  pi.setActiveTools([...others, ...ROLE_TOOLS[role.kind]]);
}

function registerCommands(pi: ExtensionAPI, envRole: Role, roles: RoleState): void {
  pi.registerCommand("sketch", sketchCommand(pi, roles));
  pi.registerCommand("handoff", handoffCommand(roles));
  if (envRole.kind !== "worker") return;
  for (const [name, command] of Object.entries(parkCommands(roles))) {
    pi.registerCommand(name, command);
  }
}

/**
 * The factory extension. `env` gives the role (`FACTORY_ROLE`, `FACTORY_TASK`) and the ledger
 * (`FACTORY_HOME`). `/sketch` gives a session without a role the `design` role, and the session
 * branch keeps it. Each role gets its prompt sections and tools. The coordinator also gets the
 * `factory` skill and a 10 second bash limit.
 */
export function factoryExtension(pi: ExtensionAPI, env: NodeJS.ProcessEnv): void {
  const envRole = roleFromEnv(env);
  let role: Role = envRole;
  const roles: RoleState = {
    get: () => role,
    set: (next) => {
      role = next;
      activateRoleTools(pi, role);
    },
    paths: ledgerPaths(factoryHome(env)),
  };
  function syncRole(_event: unknown, ctx: ExtensionContext): void {
    roles.set(resolveRole(envRole, ctx.sessionManager.getBranch()));
  }

  for (const tool of createTools(() => ({ role, paths: roles.paths }))) pi.registerTool(tool);
  registerCommands(pi, envRole, roles);
  pi.on("session_start", syncRole);
  pi.on("session_tree", syncRole);
  pi.on("resources_discover", () =>
    role.kind === "coordinator" ? { skillPaths: [FACTORY_SKILL_DIR] } : {},
  );
  pi.on("before_agent_start", async (event) => {
    Object.assign(event.systemPromptOptions.sections, await roleSections(role, roles.paths));
  });
  pi.on("tool_call", (event) => {
    if (role.kind === "coordinator" && isToolCallEventType("bash", event)) {
      capBashTimeout(event.input);
    }
  });
}
