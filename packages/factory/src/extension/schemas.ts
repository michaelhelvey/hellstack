import { type Static, type TUnsafe, Type } from "typebox";

import { taskStatusSchema } from "../core/task.ts";

function stringEnum<const T extends readonly string[]>(
  values: T,
  description: string,
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], description });
}

function id(description: string) {
  return Type.Optional(Type.String({ description }));
}

/** The parameter schema of the `factory_task` tool. */
export const taskParamsSchema = Type.Object({
  action: stringEnum(
    ["list", "get", "create", "update", "log", "check"] as const,
    "list: all tasks. get: the task file. create: a new sketch (title, repo). update: front matter. log: add a Log line (text). check: check a Landing item (item).",
  ),
  id: id("The task id, for example t-7f3a. A worker and a design session can leave it out."),
  title: Type.Optional(Type.String({ description: "create, update: the short title" })),
  repo: Type.Optional(Type.String({ description: "create: the absolute path of the repository" })),
  status: Type.Optional(stringEnum(taskStatusSchema.options, "update: the new status")),
  now: Type.Optional(Type.String({ description: "update: one line that tells what happens now" })),
  needs_you: Type.Optional(
    Type.String({ description: "update: a question for the user. An empty string clears it." }),
  ),
  threads: Type.Optional(
    Type.Array(Type.String(), { description: "update: all thread keys that the task owns" }),
  ),
  paused: Type.Optional(Type.Boolean({ description: "update: stop the reconciler for this task" })),
  text: Type.Optional(Type.String({ description: "log: the text of the Log line" })),
  item: Type.Optional(Type.Integer({ minimum: 1, description: "check: the 1-based Landing item" })),
});

/** The parameters of a `factory_task` call. */
export type TaskParams = Static<typeof taskParamsSchema>;

/** The parameter schema of the `factory_inbox` tool. */
export const inboxParamsSchema = Type.Object({
  action: stringEnum(["list", "dismiss"] as const, "list: all inbox events. dismiss: remove one."),
  id: id("dismiss: the event id"),
});

/** The parameters of a `factory_inbox` call. */
export type InboxParams = Static<typeof inboxParamsSchema>;

/** The parameter schema of the `factory_dispatch` tool. */
export const dispatchParamsSchema = Type.Object({
  id: Type.String({ description: "The id of a ready task" }),
});

/** The parameter schema of the `factory_handoff` tool. */
export const handoffParamsSchema = Type.Object({
  id: id("The id of a sketch task. A design session can leave it out."),
});
