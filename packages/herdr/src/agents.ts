import { realpathSync } from "node:fs";
import path from "node:path";
import { Config, Effect, Option, Schema } from "effect";
import { Hc, hcCall, label } from "./hc.ts";
import { HerdrApp, type Space } from "./herdr-app.ts";
import {
  DocGetResult,
  DocSetResult,
  Ignored,
  InterruptResult,
  ReadResult,
  type Report,
  SendResult,
  ServerStatus,
  Terminal,
  TerminalList,
} from "./protocol.ts";

/** The labels that this package puts on the terminals of subagents. */
export const LABELS = {
  /** The address of the agent that started the subagent. */
  parent: "hellstack.parent",
  /** The name that the parent gave the subagent. */
  name: "hellstack.name",
  /** The address of the agent at the top of the tree. */
  root: "hellstack.root",
  /** `1` when the subagent can start subagents. */
  spawn: "hellstack.spawn",
  /** `1` when the top agent shows in the herdr-app window from its start. */
  show: "hellstack.show",
  /** The herdr-app space that shows the terminal. */
  space: "herdr.space",
  /** The herdr-app tab that shows the terminal. */
  tab: "herdr.tab",
} as const;

/** A failed agent operation, with a message for the model. */
export class AgentError extends Schema.TaggedError<AgentError, { readonly brand: unique symbol }>()(
  "AgentError",
  { message: Schema.String },
) {}

/** This pi: its hc terminal, and its working folder. */
export interface Me {
  readonly address: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/** True when another agent started this pi. */
export const isChild = (me: Me) => Option.isSome(label(me.labels, LABELS.parent));

/** True when this pi can start subagents. */
export const canSpawn = (me: Me) => !isChild(me) || me.labels[LABELS.spawn] === "1";

/** True when this pi shows in the herdr-app window from its start. */
export const showsAtStart = (me: Me) => !isChild(me) && me.labels[LABELS.show] === "1";

const NOT_IN_HC =
  "pi does not run in an hc terminal ($HC_TERMINAL_ID is not set). Start pi in hc with `hpi` (see the hellstack README) to use subagents.";

const serverStatus = hcCall("server.status", {}, ServerStatus);

/**
 * Makes sure that pi runs in an hc terminal and that the herdr-core server runs, and gives this
 * pi. If the server does not answer, this runs `hc server start` one time.
 */
export const preflight = (cwd: string) =>
  Effect.gen(function* () {
    const address = yield* Config.String("HC_TERMINAL_ID").pipe(
      Effect.mapError(() => new AgentError({ message: NOT_IN_HC })),
    );
    yield* serverStatus.pipe(
      Effect.catch(() => Hc.use((hc) => hc.startServer).pipe(Effect.andThen(serverStatus))),
    );
    const self = yield* hcCall("terminal.get", { terminal: address }, Terminal);
    return { address, labels: self.labels, cwd } satisfies Me;
  });

/** The live subagents that the agent with the address started. */
export const children = (parent: string) =>
  Effect.map(
    hcCall("terminal.list", { labels: { [LABELS.parent]: parent } }, TerminalList),
    (list) => list.terminals,
  );

/** The name that the parent gave a subagent. */
export const nameOf = (terminal: Terminal) => terminal.labels[LABELS.name] ?? terminal.address;

const namesOf = (terminals: ReadonlyArray<Terminal>) => terminals.map(nameOf).join(", ") || "none";

/** Finds the live subagent with the name. */
export const findChild = (me: Me, name: string) =>
  Effect.flatMap(children(me.address), (terminals) =>
    Effect.fromNullishOr(terminals.find((t) => nameOf(t) === name)).pipe(
      Effect.mapError(
        () =>
          new AgentError({
            message: `no subagent named "${name}". Your subagents: ${namesOf(terminals)}`,
          }),
      ),
    ),
  );

const real = (p: string) => Effect.try(() => realpathSync(p)).pipe(Effect.orElseSucceed(() => p));

const samePath = (a: string, b: string) =>
  Effect.map(Effect.all([real(a), real(b)]), ([x, y]) => x === y);

const setLabels = (terminal: string, labels: Record<string, string>) =>
  hcCall("terminal.label", { terminal, labels }, Ignored);

/** Makes a space for this pi, and moves this pi into its first tab in place of its shell. */
const newSpace = (me: Me) =>
  Effect.gen(function* () {
    const made = yield* HerdrApp.use((app) =>
      app.newSpace(path.basename(me.cwd) || me.cwd, me.cwd),
    );
    yield* setLabels(me.address, { [LABELS.space]: made.space, [LABELS.tab]: made.tab });
    yield* hcCall("terminal.kill", { terminal: made.terminal }, Ignored);
    return made.space;
  });

const findSpace = (spaces: ReadonlyArray<Space>, cwd: string) =>
  Effect.findFirst(spaces, (space) => samePath(space.folder ?? "", cwd));

/** Shows the agents that this pi started, and their subagents, in the space. */
const showTree = (me: Me, space: string) =>
  Effect.gen(function* () {
    yield* setLabels(me.address, { [LABELS.space]: space });
    const tree = yield* hcCall(
      "terminal.list",
      { labels: { [LABELS.root]: me.address } },
      TerminalList,
    );
    const hidden = tree.terminals.filter((t) => t.labels[LABELS.space] === undefined);
    yield* Effect.forEach(hidden, (t) => setLabels(t.address, { [LABELS.space]: space }));
  });

/**
 * Finds or makes the herdr-app space for the folder of the top agent, and shows the agent tree
 * in it. Gives `None` when the herdr-app window does not run.
 */
const rootSpace = (me: Me) =>
  Effect.gen(function* () {
    const found = yield* findSpace(yield* HerdrApp.use((app) => app.spaces), me.cwd);
    const space = Option.isSome(found) ? found.value.id : yield* newSpace(me);
    yield* showTree(me, space);
    return space;
  }).pipe(Effect.option);

/**
 * The herdr-app space for the subagents of this pi. A subagent uses the space of its own
 * terminal. The top agent finds or makes a space for its folder.
 */
export const spaceFor = (me: Me): Effect.Effect<Option.Option<string>, never, Hc | HerdrApp> =>
  Option.match(label(me.labels, LABELS.space), {
    onSome: (space) => Effect.succeedSome(space),
    onNone: () => (isChild(me) ? Effect.succeedNone : rootSpace(me)),
  });

/** What a parent asks for when it starts a subagent. */
export interface SpawnInput {
  readonly name: string;
  readonly task: string;
  readonly model?: string | undefined;
  readonly thinking?: string | undefined;
  readonly cwd: string;
  readonly allowSubagents: boolean;
  /** Give `--approve` to pi: trust the project files of the folder. */
  readonly approve: boolean;
  /** The environment of the subagent, on top of the environment of the hc core. */
  readonly env: Readonly<Record<string, string>>;
}

const flag = (name: string, value: string | undefined) => (value ? [name, value] : []);

const argv = (input: SpawnInput) => [
  "pi",
  ...flag("--model", input.model),
  ...flag("--thinking", input.thinking),
  ...(input.approve ? ["--approve"] : []),
  "--name",
  input.name,
  "--",
  input.task,
];

const labelsFor = (me: Me, input: SpawnInput, space: Option.Option<string>) => ({
  [LABELS.parent]: me.address,
  [LABELS.name]: input.name,
  [LABELS.root]: me.labels[LABELS.root] ?? me.address,
  ...(input.allowSubagents ? { [LABELS.spawn]: "1" } : {}),
  ...Option.match(space, { onNone: () => ({}), onSome: (id) => ({ [LABELS.space]: id }) }),
});

const assertNew = (terminals: ReadonlyArray<Terminal>, name: string) =>
  terminals.some((t) => nameOf(t) === name)
    ? Effect.fail(new AgentError({ message: `a subagent named "${name}" already runs` }))
    : Effect.void;

/**
 * Starts a pi subagent in a new hc terminal, as a child of this pi. The subagent ends when this
 * pi ends. hc types no notes into this pi: the subagent reports with the `report` tool.
 */
export const spawn = (me: Me, input: SpawnInput) =>
  Effect.gen(function* () {
    yield* assertNew(yield* children(me.address), input.name);
    const space = yield* spaceFor(me);
    return yield* hcCall(
      "terminal.run",
      {
        argv: argv(input),
        cwd: input.cwd,
        name: `${me.address}-${input.name}`.slice(0, 32),
        parent: me.address,
        no_notify: true,
        labels: labelsFor(me, input, space),
        env: input.env,
      },
      Terminal,
    );
  });

/** Types the text into the subagent and presses Enter. Gives the subagent and the result. */
export const send = (me: Me, name: string, text: string) =>
  Effect.flatMap(findChild(me, name), (child) =>
    Effect.map(
      hcCall("terminal.send", { terminal: child.address, text, caller: me.address }, SendResult),
      (result) => ({ child, result }),
    ),
  );

/** Reads the screen of the subagent, and `lines` lines of history above it. */
export const read = (me: Me, name: string, lines: number) =>
  Effect.flatMap(findChild(me, name), (child) =>
    hcCall("terminal.read", { terminal: child.address, lines, caller: me.address }, ReadResult),
  );

/** Stops the current turn of the subagent. */
export const interrupt = (me: Me, name: string) =>
  Effect.flatMap(findChild(me, name), (child) =>
    hcCall("terminal.interrupt", { terminal: child.address }, InterruptResult),
  );

/** Ends the subagent with the address. Its own subagents end with it. */
export const kill = (address: string) => hcCall("terminal.kill", { terminal: address }, Ignored);

/** The name of the hc document that holds the reports of a subagent to its parent. */
export const docName = (parent: string, child: string) => `r-${parent}-${child}`;

const writeDoc = (name: string, value: unknown) =>
  Effect.flatMap(hcCall("doc.get", { name }, DocGetResult), (doc) =>
    hcCall("doc.set", { name, value, version: doc.version }, DocSetResult),
  );

/** Deletes the value of an hc document. Another writer between the read and the write fails it. */
export const clearDoc = (name: string) => writeDoc(name, null);

/** Sends a report from this subagent to its parent. */
export const report = (me: Me, value: Report) =>
  Effect.gen(function* () {
    const parent = yield* Effect.fromOption(label(me.labels, LABELS.parent)).pipe(
      Effect.mapError(() => new AgentError({ message: "this pi is not a subagent" })),
    );
    yield* writeDoc(docName(parent, me.address), value).pipe(Effect.retry({ times: 2 }));
    return parent;
  });
