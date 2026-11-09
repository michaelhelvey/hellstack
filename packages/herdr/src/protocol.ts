import { Schema } from "effect";

/** The word that a program in a terminal gives for what it does (an OSC 7501 record). */
export const Status = Schema.Struct({
  /** `idle`, `working`, `done`, `blocked`, or `error`. */
  state: Schema.String,
  kind: Schema.optional(Schema.NullOr(Schema.String)),
  msg: Schema.optional(Schema.String),
});

/** The type of a {@link Status}. */
export type Status = typeof Status.Type;

/** An hc terminal, with the fields that this package reads. */
export const Terminal = Schema.Struct({
  /** The permanent address of the terminal on this core, for example `t7`. */
  address: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  labels: Schema.Record(Schema.String, Schema.String),
  cwd: Schema.String,
  /** `live` or `finished`. */
  state: Schema.String,
  parent: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Status)),
});

/** The type of a {@link Terminal}. */
export type Terminal = typeof Terminal.Type;

/** The result of `terminal.list`. */
export const TerminalList = Schema.Struct({ terminals: Schema.Array(Terminal) });

/** The result of `terminal.read`. */
export const ReadResult = Schema.Struct({
  text: Schema.String,
  complete: Schema.Boolean,
  why: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The result of `terminal.send`. */
export const SendResult = Schema.Struct({
  started: Schema.optional(Schema.NullOr(Schema.Boolean)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The result of `terminal.interrupt`. */
export const InterruptResult = Schema.Struct({ outcome: Schema.String });

/** The result of `server.status`. */
export const ServerStatus = Schema.Struct({ version: Schema.String });

/** The result of `doc.get`. */
export const DocGetResult = Schema.Struct({ value: Schema.Unknown, version: Schema.Finite });

/** The result of `doc.set`. */
export const DocSetResult = Schema.Struct({ version: Schema.Finite });

/** A result that this package does not read. */
export const Ignored = Schema.Unknown;

/** An error that hc gives for a request. */
export const RpcError = Schema.Struct({
  message: Schema.String,
  data: Schema.optional(Schema.NullOr(Schema.Struct({ kind: Schema.optional(Schema.String) }))),
});

/** A JSON-RPC response from hc. */
export const RpcResponse = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(RpcError),
});

/**
 * A fact change from `events.subscribe`. `terminal` is empty for events that are not about a
 * terminal, for example `doc` events.
 */
export const HcEvent = Schema.Struct({
  type: Schema.String,
  terminal: Schema.optional(Schema.String),
  data: Schema.Unknown,
});

/** The type of an {@link HcEvent}. */
export type HcEvent = typeof HcEvent.Type;

/** A notification on an `events.subscribe` connection. */
export const Notification = Schema.Struct({
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
});

/** The data of a `status` event. */
export const StatusData = Schema.Struct({ status: Schema.NullOr(Status) });

/** The data of a `turn` event. */
export const TurnData = Schema.Struct({ state: Schema.String });

/** The data of a `finished` event. */
export const FinishedData = Schema.Struct({
  exit_code: Schema.optional(Schema.NullOr(Schema.Finite)),
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The data of a `doc` event. */
export const DocData = Schema.Struct({ name: Schema.String, version: Schema.Finite });

/** A report from a subagent to its parent, kept in an hc document. */
export const Report = Schema.Struct({
  status: Schema.Literals(["done", "stuck", "progress"]),
  summary: Schema.String,
  file: Schema.optional(Schema.String),
});

/** The type of a {@link Report}. */
export type Report = typeof Report.Type;

/** A space in the herdr-app window, with the fields that this package reads. */
export const Space = Schema.Struct({
  id: Schema.String,
  folder: Schema.NullOr(Schema.String),
});

/** The result of `herdr-app ls`. */
export const AppList = Schema.Struct({ spaces: Schema.Array(Space) });

/** The result of `herdr-app do space.new`. */
export const NewSpace = Schema.Struct({
  space: Schema.String,
  tab: Schema.String,
  terminal: Schema.String,
});

/** The type of a {@link NewSpace}. */
export type NewSpace = typeof NewSpace.Type;
