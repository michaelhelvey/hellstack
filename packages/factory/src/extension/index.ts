import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ledgerPaths } from "../core/paths.ts";
import { ROLE_COMMANDS, roleCommands, sketchCommand, type RoleState } from "./commands.ts";
import { FACTORY_SKILL_DIR, roleSections } from "./prompt.ts";
import { resolveRole, roleFromEnv, type Role } from "./role.ts";
import { createTool, ROLE_TOOLS, TOOL_NAMES } from "./tools.ts";

/** The longest time in seconds that a bash command of the coordinator can run. */
export const COORDINATOR_BASH_LIMIT = 10;

/** Sets the timeout of a bash call to at most {@link COORDINATOR_BASH_LIMIT} seconds. */
export function capBashTimeout(input: { timeout?: number }): void {
  input.timeout = Math.min(input.timeout ?? COORDINATOR_BASH_LIMIT, COORDINATOR_BASH_LIMIT);
}

function isFactoryTool(name: string): boolean {
  return TOOL_NAMES.some((tool) => tool === name);
}

function roleApplier(pi: ExtensionAPI, roles: RoleState): () => void {
  const registered = new Set<string>();
  const commands = roleCommands(roles);
  return () => {
    const kind = roles.get().kind;
    for (const name of ROLE_TOOLS[kind].filter((tool) => !registered.has(tool))) {
      pi.registerTool(createTool(name, () => roles.get()));
      registered.add(name);
    }
    for (const name of ROLE_COMMANDS[kind].filter((cmd) => !registered.has(`/${cmd}`))) {
      pi.registerCommand(name, commands[name]);
      registered.add(`/${name}`);
    }
    const others = pi.getActiveTools().filter((name) => !isFactoryTool(name));
    pi.setActiveTools([...others, ...ROLE_TOOLS[kind]]);
  };
}

/**
 * The factory extension. `env` gives the role (`FACTORY_ROLE`, `FACTORY_TASK`). `/sketch` gives a
 * session without a role the `design` role, and the session keeps it. Each role gets its prompt
 * sections and tools. The coordinator also gets the `factory` skill and a 10 second bash limit.
 */
export function factoryExtension(pi: ExtensionAPI, env: NodeJS.ProcessEnv): void {
  const envRole = roleFromEnv(env);
  let role: Role = envRole;
  const roles: RoleState = {
    get: () => role,
    set: (next) => {
      role = next;
      applyRole();
    },
  };
  const applyRole = roleApplier(pi, roles);

  pi.registerCommand("sketch", sketchCommand(pi, roles));
  pi.on("session_start", (_event, ctx) => {
    roles.set(resolveRole(envRole, ctx.sessionManager.getBranch()));
  });
  pi.on("resources_discover", () =>
    role.kind === "coordinator" ? { skillPaths: [FACTORY_SKILL_DIR] } : {},
  );
  pi.on("before_agent_start", async (event) => {
    Object.assign(event.systemPromptOptions.sections, await roleSections(role, ledgerPaths()));
  });
  pi.on("tool_call", (event) => {
    if (role.kind === "coordinator" && isToolCallEventType("bash", event)) {
      capBashTimeout(event.input);
    }
  });
}
