import { Effect, Option, Schedule, Schema, Stream } from "effect";
import { children, clearDoc, docName } from "./agents.ts";
import { Hc, HcError, hcCall } from "./hc.ts";
import type { Inbox } from "./inbox.ts";
import { DocData, DocGetResult, type HcEvent, Ignored, Report } from "./protocol.ts";

const decodeOption = <A>(schema: Schema.Decoder<A>) => Schema.decodeUnknownOption(schema);

/** Reads the report document of a subagent and gives the report to the inbox. */
const readReport = (inbox: Inbox, name: string, address: string) =>
  hcCall("doc.get", { name }, DocGetResult).pipe(
    Effect.map((doc) => decodeOption(Report)(doc.value)),
    Effect.map(Option.map((report) => inbox.report(address, report))),
  );

const onDoc = (inbox: Inbox, event: HcEvent) =>
  Option.match(
    Option.flatMap(decodeOption(DocData)(event.data), (data) =>
      Option.map(inbox.childForDoc(data.name), (address) => ({ name: data.name, address })),
    ),
    {
      onNone: () => Effect.void,
      onSome: ({ name, address }) => readReport(inbox, name, address),
    },
  );

/** Applies the exit, then removes the finished terminal and its report document. */
const onFinished = (inbox: Inbox, event: HcEvent) => {
  const address = event.terminal ?? "";
  const known = inbox.has(address);
  inbox.apply(event);
  return known
    ? Effect.all([
        clearDoc(docName(inbox.parent, address)),
        hcCall("terminal.rm", { terminal: address }, Ignored),
      ])
    : Effect.void;
};

type Step = (inbox: Inbox, event: HcEvent) => Effect.Effect<unknown, HcError, Hc>;

const applyEvent: Step = (inbox, event) => Effect.sync(() => inbox.apply(event));

const STEPS: Readonly<Record<string, Step>> = { doc: onDoc, finished: onFinished };

const step = (inbox: Inbox, event: HcEvent) =>
  (STEPS[event.type] ?? applyEvent)(inbox, event).pipe(Effect.ignore);

/**
 * Follows the fact changes of the hc core, and gives the news about the subagents of the inbox
 * parent to the inbox. It reconnects after 5 seconds when hc closes the connection.
 */
export const watch = (inbox: Inbox) =>
  Effect.gen(function* () {
    inbox.sync(yield* children(inbox.parent));
    const hc = yield* Hc;
    yield* hc.events.pipe(Stream.runForEach((event) => step(inbox, event)));
    return yield* new HcError({ message: "hc closed the event stream" });
  }).pipe(Effect.retry(Schedule.spaced("5 seconds")));
