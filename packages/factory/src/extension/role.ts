import { z } from "zod";

import { taskIdSchema as taskId } from "../core/task.ts";

/** The custom session entry type that keeps the role that `/sketch` gives a session. */
export const ROLE_ENTRY = "factory-role";

/** The role of a session that `/sketch` makes. Pi keeps it in a session entry. */
export const designRoleSchema = z.object({ kind: z.literal("design"), task: taskId });

/** The role of a session. A `worker` and a `design` session each own one task. */
export type Role =
  | { kind: "none" }
  | { kind: "coordinator" }
  | { kind: "subagent" }
  | { kind: "worker"; task: string }
  | z.infer<typeof designRoleSchema>;

/** The roles that own one task. */
export type TaskRole = Extract<Role, { task: string }>;

const envSchema = z.union([
  z.object({ FACTORY_ROLE: z.undefined() }).transform((): Role => ({ kind: "none" })),
  z
    .object({ FACTORY_ROLE: z.enum(["coordinator", "subagent"]) })
    .transform((env): Role => ({ kind: env.FACTORY_ROLE })),
  z
    .object({ FACTORY_ROLE: z.enum(["worker", "design"]), FACTORY_TASK: taskId })
    .transform((env): Role => ({ kind: env.FACTORY_ROLE, task: env.FACTORY_TASK })),
]);

/**
 * Returns the role that `FACTORY_ROLE` (and `FACTORY_TASK` for a worker or a design agent) sets.
 * Returns `none` when `FACTORY_ROLE` is not set. Throws when the values are not valid.
 *
 * @example roleFromEnv({ FACTORY_ROLE: "worker", FACTORY_TASK: "t-7f3a" }) // { kind: "worker", task: "t-7f3a" }
 */
export function roleFromEnv(env: NodeJS.ProcessEnv): Role {
  const result = envSchema.safeParse({ ...env, FACTORY_ROLE: env.FACTORY_ROLE || undefined });
  if (!result.success) {
    throw new Error(`factory: bad FACTORY_ROLE or FACTORY_TASK: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** A session entry, as far as the role needs it. */
export interface RoleEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

function entryRole(entry: RoleEntry): Role[] {
  if (entry.type !== "custom" || entry.customType !== ROLE_ENTRY) return [];
  const result = designRoleSchema.safeParse(entry.data);
  return result.success ? [result.data] : [];
}

/**
 * Returns the role of a session. The environment role has priority. Else the last role entry of
 * the session branch applies. Else the role is `none`.
 */
export function resolveRole(envRole: Role, entries: readonly RoleEntry[]): Role {
  if (envRole.kind !== "none") return envRole;
  return entries.flatMap(entryRole).at(-1) ?? envRole;
}
