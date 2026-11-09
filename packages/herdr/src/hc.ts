import { NodeServices } from "@effect/platform-node";
import { Config, Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { HcEvent, Notification, RpcResponse } from "./protocol.ts";

/** A failed hc request, or hc is not available. `kind` is the error kind that hc gives. */
export class HcError extends Schema.TaggedError<HcError, { readonly brand: unique symbol }>()(
  "HcError",
  {
    message: Schema.String,
    kind: Schema.optional(Schema.String),
  },
) {}

const encoder = new TextEncoder();

const requestLine = (method: string, params: Record<string, unknown>) =>
  encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`);

const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(RpcResponse));
const decodeNotification = Schema.decodeUnknownOption(Schema.fromJsonString(Notification));
const decodeEvent = Schema.decodeUnknownOption(HcEvent);

/** Gives the event in a line from an `events.subscribe` connection, if the line has one. */
const toEvent = (line: string) =>
  decodeNotification(line).pipe(
    Option.filter((note) => note.method === "event"),
    Option.flatMap((note) => decodeEvent(note.params)),
  );

const unavailable = (bin: string) => (error: { readonly message: string }) =>
  new HcError({ message: `cannot run \`${bin}\` (is herdr-core installed?): ${error.message}` });

const badResponse = (method: string) => (error: { readonly message: string }) =>
  new HcError({ message: `unexpected response from hc to ${method}: ${error.message}` });

const firstLine = (output: string) => output.split("\n").find((line) => line.trim() !== "") ?? "";

const resultOf = (method: string, response: typeof RpcResponse.Type) =>
  response.error
    ? Effect.fail(
        new HcError({
          message: `hc ${method} failed: ${response.error.message}`,
          kind: response.error.data?.kind,
        }),
      )
    : Effect.succeed(response.result);

/**
 * The herdr-core API. Each call runs `hc connect` and sends one JSON-RPC request. `hc connect`
 * starts the core when it does not run.
 */
export class Hc extends Context.Service<
  Hc,
  {
    /** Sends one request and decodes its result with the schema. */
    call<A>(
      method: string,
      params: Record<string, unknown>,
      schema: Schema.Decoder<A>,
    ): Effect.Effect<A, HcError>;
    /** All fact changes on the core, from `events.subscribe` without a filter. */
    readonly events: Stream.Stream<HcEvent, HcError>;
    /** Runs `hc server start`. */
    readonly startServer: Effect.Effect<void, HcError>;
  }
>()("hellstack-herdr/Hc") {
  /** Runs the `hc` binary from `$HC_BIN`, or `hc` from the `PATH`. */
  static readonly layer = Layer.effect(
    Hc,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const bin = yield* Config.String("HC_BIN").pipe(Config.withDefault("hc"), Effect.orDie);

      const connect = (input: Stream.Stream<Uint8Array>) =>
        ChildProcess.make(bin, ["connect"], { stdin: input });

      const call = <A>(
        method: string,
        params: Record<string, unknown>,
        schema: Schema.Decoder<A>,
      ) =>
        spawner.string(connect(Stream.make(requestLine(method, params)))).pipe(
          Effect.mapError(unavailable(bin)),
          Effect.flatMap((output) =>
            decodeResponse(firstLine(output)).pipe(Effect.mapError(badResponse(method))),
          ),
          Effect.flatMap((response) => resultOf(method, response)),
          Effect.flatMap((result) =>
            Schema.decodeUnknownEffect(schema)(result).pipe(Effect.mapError(badResponse(method))),
          ),
        );

      const events = spawner
        .streamLines(
          connect(Stream.concat(Stream.make(requestLine("events.subscribe", {})), Stream.never)),
        )
        .pipe(
          Stream.mapError(unavailable(bin)),
          Stream.map(toEvent),
          Stream.filter(Option.isSome),
          Stream.map((event) => event.value),
        );

      const startServer = spawner.exitCode(ChildProcess.make(bin, ["server", "start"])).pipe(
        Effect.mapError(unavailable(bin)),
        Effect.filterOrFail(
          (code) => code === ChildProcessSpawner.ExitCode(0),
          (code) => new HcError({ message: `\`${bin} server start\` failed with code ${code}` }),
        ),
        Effect.asVoid,
      );

      return Hc.of({ call, events, startServer });
    }),
  ).pipe(Layer.provide(NodeServices.layer));
}

/** Calls hc. */
export const hcCall = <A>(
  method: string,
  params: Record<string, unknown>,
  schema: Schema.Decoder<A>,
) => Hc.use((hc) => hc.call(method, params, schema));

/** Gives `Some` when the label is set. */
export const label = (labels: Readonly<Record<string, string>>, key: string) =>
  Option.fromNullishOr(labels[key]);
