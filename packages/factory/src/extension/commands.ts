import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { createTask, logTask, updateTask } from "../core/ledger.ts";
import { taskPath, type LedgerPaths } from "../core/paths.ts";
import { runHandoff } from "./actions.ts";
import { ROLE_ENTRY, type Role } from "./role.ts";

/**
 * Reads and changes the role of the session, and gives the ledger of the session. `env` is the role
 * that the environment sets.
 */
export interface RoleState {
  get(): Role;
  set(role: Role): void;
  env: Role;
  paths: LedgerPaths;
}

/** A command as `pi.registerCommand` takes it. */
export interface FactoryCommand {
  description: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<string>;

function command(description: string, run: Handler): FactoryCommand {
  return {
    description,
    handler: async (args, ctx) => {
      try {
        ctx.ui.notify(await run(args, ctx), "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  };
}

function requireRole(role: Role, kind: "worker" | "design"): string {
  if (role.kind !== kind) throw new Error(`only a factory ${kind} session can do this`);
  return role.task;
}

/** Returns the message that starts a design conversation about task `id`. */
export function sketchMessage(paths: LedgerPaths, id: string, title: string): string {
  return `I started the factory sketch ${id} "${title}". The task file is ${taskPath(paths, id)}. Help me write it.`;
}

/**
 * Returns the `/sketch <title>` command. It makes a `sketch` task with `cwd` set to the session
 * folder, makes the session the `design` role of that task, and starts a turn. A session with a
 * `FACTORY_ROLE` cannot use it.
 */
export function sketchCommand(pi: ExtensionAPI, roles: RoleState): FactoryCommand {
  return command("Start a factory task sketch: /sketch <title>", async (args, ctx) => {
    const kind = roles.env.kind;
    if (kind !== "none") {
      throw new Error(
        `this session is the factory ${kind}; /sketch needs a session without a role`,
      );
    }
    const title = args.trim();
    if (!title) throw new Error("usage: /sketch <title>");
    const task = await createTask({ title, cwd: ctx.cwd }, roles.paths);
    const role = { kind: "design", task: task.meta.id } as const;
    pi.appendEntry(ROLE_ENTRY, role);
    roles.set(role);
    const content = sketchMessage(roles.paths, task.meta.id, title);
    pi.sendMessage({ customType: "factory", content, display: true }, { triggerTurn: true });
    return `Factory sketch ${task.meta.id} started.`;
  });
}

/** Returns the `/handoff` command. Only a design session can use it. */
export function handoffCommand(roles: RoleState): FactoryCommand {
  return command("Hand off this factory sketch: make it ready", () => {
    const role = roles.get();
    return runHandoff({ role, paths: roles.paths }, requireRole(role, "design"));
  });
}

async function setPaused(roles: RoleState, paused: boolean): Promise<string> {
  const id = requireRole(roles.get(), "worker");
  await updateTask(id, { paused }, roles.paths);
  await logTask(id, { who: "user", text: paused ? "parked" : "unparked" }, roles.paths);
  return paused
    ? `Task ${id} is parked. factoryd does not restart this worker.`
    : `Task ${id} is not parked.`;
}

/** Returns the `/park` and `/unpark` commands of a worker session. */
export function parkCommands(roles: RoleState): Record<"park" | "unpark", FactoryCommand> {
  return {
    park: command("Park this factory task: factoryd does not restart it", () =>
      setPaused(roles, true),
    ),
    unpark: command("Unpark this factory task", () => setPaused(roles, false)),
  };
}
