import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { createTask, handoff, logTask, updateTask } from "../core/ledger.ts";
import { ledgerPaths, taskPath } from "../core/paths.ts";
import { ROLE_ENTRY, type Role } from "./role.ts";

/** Reads and changes the role of the session. */
export interface RoleState {
  get(): Role;
  set(role: Role): void;
}

/** The names of the commands that only some roles have. */
export type RoleCommandName = "handoff" | "park" | "unpark";

/** The role commands of each role. `/sketch` is in every session. */
export const ROLE_COMMANDS: Record<Role["kind"], readonly RoleCommandName[]> = {
  none: [],
  subagent: [],
  coordinator: [],
  worker: ["park", "unpark"],
  design: ["handoff"],
};

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

function ownTask(role: Role, kind: "worker" | "design"): string {
  if (role.kind !== kind) throw new Error(`only a factory ${kind} session can do this`);
  return role.task;
}

/** Returns the message that starts a design conversation about task `id`. */
export function sketchMessage(id: string, title: string): string {
  return `I started the factory sketch ${id} "${title}". The task file is ${taskPath(ledgerPaths(), id)}. Help me write it.`;
}

/**
 * Returns the `/sketch <title>` command. It makes a `sketch` task with `repo` set to the session
 * folder, makes the session the `design` role of that task, and starts a turn. A session with a
 * `FACTORY_ROLE` cannot use it.
 */
export function sketchCommand(pi: ExtensionAPI, roles: RoleState): FactoryCommand {
  return command("Start a factory task sketch: /sketch <title>", async (args, ctx) => {
    const kind = roles.get().kind;
    if (kind !== "none" && kind !== "design") {
      throw new Error(
        `this session is the factory ${kind}; /sketch needs a session without a role`,
      );
    }
    const title = args.trim();
    if (!title) throw new Error("usage: /sketch <title>");
    const task = await createTask({ title, repo: ctx.cwd });
    const role = { kind: "design", task: task.meta.id } as const;
    pi.appendEntry(ROLE_ENTRY, role);
    roles.set(role);
    const content = sketchMessage(task.meta.id, title);
    pi.sendMessage({ customType: "factory", content, display: true }, { triggerTurn: true });
    return `Factory sketch ${task.meta.id} started.`;
  });
}

async function runHandoffCommand(roles: RoleState): Promise<string> {
  const result = await handoff(ownTask(roles.get(), "design"));
  if (!result.ok) throw new Error(`handoff failed:\n- ${result.missing.join("\n- ")}`);
  return `Task ${result.task.meta.id} is ready. The coordinator dispatches it.`;
}

async function setPaused(roles: RoleState, paused: boolean): Promise<string> {
  const id = ownTask(roles.get(), "worker");
  await updateTask(id, { paused });
  await logTask(id, { who: "user", text: paused ? "parked" : "unparked" });
  return paused
    ? `Task ${id} is parked. factoryd does not restart this worker.`
    : `Task ${id} is not parked.`;
}

/** Returns the role commands by name. */
export function roleCommands(roles: RoleState): Record<RoleCommandName, FactoryCommand> {
  return {
    handoff: command("Hand off this factory sketch: make it ready", () => runHandoffCommand(roles)),
    park: command("Park this factory task: factoryd does not restart it", () =>
      setPaused(roles, true),
    ),
    unpark: command("Unpark this factory task", () => setPaused(roles, false)),
  };
}
