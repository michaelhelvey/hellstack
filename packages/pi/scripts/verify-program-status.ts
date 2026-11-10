/**
 * Verifies that pi reports its state to Rex with the Program Status Protocol (OSC 7501).
 *
 * The script starts pi with the hellstack extension and a fake model in a new Rex session. It
 * reads the `program_status_changed` events of the pi block from `rex events`, sends prompts and
 * keys with `rex send`, and asserts the state transitions. At the end, it kills the Rex session.
 *
 * @example
 * ```sh
 * bun packages/pi/scripts/verify-program-status.ts
 * ```
 */
import { z } from "zod";
import { FAKE_MODEL } from "../tests/fake-model.ts";
import { PiSandbox } from "../tests/pi.ts";

const STEP_TIMEOUT_MS = 20_000;

const StatusEventSchema = z.object({
  payload: z.object({
    event: z.object({
      type: z.literal("block_event"),
      payload: z.object({
        block_id: z.string(),
        name: z.literal("program_status_changed"),
        payload: z.object({
          record: z
            .object({ state: z.string(), kind: z.string().optional() })
            .transform(({ state, kind }) => (kind === undefined ? state : `${state}/${kind}`)),
        }),
      }),
    }),
  }),
});

const SessionSchema = z.object({ session_id: z.string() });
const RunSchema = z.object({ block_ids: z.tuple([z.string()], z.string()) });

const rex = async (...args: Array<string>): Promise<string> => {
  const proc = Bun.spawn(["timeout", "15", "rex", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`rex ${args.join(" ")} failed (${code}): ${err}`);
  return out;
};

/** The states of one block, in order, as `state` or `state/kind`. Repeated states collapse. */
class StatusLog {
  readonly states: Array<string> = [];
  #cursor = 0;
  #stopped: string | undefined;

  constructor(
    private readonly block: string,
    lines: ReadableStream<Uint8Array>,
  ) {
    void this.#read(lines).then(
      () => (this.#stopped = "rex events stopped"),
      (error: unknown) => (this.#stopped = `rex events failed: ${String(error)}`),
    );
  }

  async #read(lines: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const bytes of lines) {
      buffer += decoder.decode(bytes, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      parts.forEach((line) => this.#add(line));
    }
  }

  #add(line: string): void {
    const parsed = StatusEventSchema.safeParse(JSON.parse(line));
    if (!parsed.success) return;
    const event = parsed.data.payload.event.payload;
    const label = event.payload.record;
    if (event.block_id !== this.block || this.states.at(-1) === label) return;
    console.log(`  status: ${label}`);
    this.states.push(label);
  }

  /** Waits until the next states are `expected`, in order and with no other states between. */
  async expect(...expected: Array<string>): Promise<void> {
    await this.#waitForCount(this.#cursor + expected.length, Date.now() + STEP_TIMEOUT_MS);
    const actual = this.states.slice(this.#cursor, this.#cursor + expected.length).join(",");
    if (actual !== expected.join(",")) {
      const all = this.states.join(",");
      throw new Error(`expected states [${expected.join(",")}], got [${actual}] (all: [${all}])`);
    }
    this.#cursor += expected.length;
  }

  async #waitForCount(count: number, deadline: number): Promise<void> {
    if (this.states.length >= count || Date.now() > deadline) return;
    if (this.#stopped !== undefined) throw new Error(this.#stopped);
    await Bun.sleep(50);
    return this.#waitForCount(count, deadline);
  }
}

/** A pi process in a Rex block. */
class RexPi {
  constructor(
    readonly session: string,
    readonly block: string,
  ) {}

  async waitForScreen(text: string, deadline = Date.now() + STEP_TIMEOUT_MS): Promise<void> {
    const screen = await rex("capture", "-s", this.session, "-b", this.block, "--trim");
    if (screen.includes(text)) return;
    if (Date.now() > deadline) throw new Error(`no "${text}" on screen:\n${screen}`);
    await Bun.sleep(200);
    return this.waitForScreen(text, deadline);
  }

  async submit(text: string): Promise<void> {
    await rex("send", "-s", this.session, "-b", this.block, text);
    await Bun.sleep(200);
    await this.key("enter");
  }

  async key(key: string): Promise<void> {
    await rex("send-key", "-s", this.session, "-b", this.block, key);
  }
}

const scenarios: ReadonlyArray<{
  readonly name: string;
  readonly run: (sandbox: PiSandbox, pi: RexPi, log: StatusLog) => Promise<void>;
}> = [
  {
    name: "a prompt that the model answers: working, then done",
    run: async (sandbox, pi, log) => {
      sandbox.model.reply("Hello from the fake model.");
      await pi.submit("say hello");
      await log.expect("working", "done");
    },
  },
  {
    name: "ask_user_question: blocked/question until the user answers",
    run: async (sandbox, pi, log) => {
      sandbox.model.callTools({
        name: "ask_user_question",
        arguments: {
          questions: [{ question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] }],
        },
      });
      await pi.submit("ask me");
      await log.expect("working", "blocked/question");
      await pi.key("enter");
      await log.expect("working", "done");
    },
  },
  {
    name: "a model error: working, then error",
    run: async (sandbox, pi, log) => {
      sandbox.model.fail("the fake model refuses");
      await pi.submit("fail");
      await log.expect("working", "error");
    },
  },
  {
    name: "the user aborts a running tool with Escape: working, then idle",
    run: async (sandbox, pi, log) => {
      sandbox.model.callTools({ name: "bash", arguments: { command: "sleep 30" } });
      await pi.submit("sleep");
      await log.expect("working");
      await Bun.sleep(500);
      await pi.key("escape");
      await log.expect("idle");
    },
  },
];

const main = async () => {
  const sandbox = await PiSandbox.create();
  try {
    await verify(sandbox);
  } finally {
    await sandbox.dispose();
  }
};

const verify = async (sandbox: PiSandbox) => {
  const name = `pi-status-verify-${process.pid}`;
  const { session_id: session } = SessionSchema.parse(JSON.parse(await rex("new", name, "--json")));
  console.log(`rex session ${session}`);
  const events = Bun.spawn(["rex", "events", "-s", session, "--json"], {
    stdout: "pipe",
    stderr: "ignore",
  });

  try {
    const env = Object.entries(sandbox.env()).map(([key, value]) => `${key}=${value}`);
    const run = RunSchema.parse(
      JSON.parse(
        await rex(
          "run",
          "-s",
          session,
          "--focus=false",
          "--json",
          "--shell=none",
          "-c",
          sandbox.workDir,
          "--",
          "env",
          ...env,
          ...sandbox.command(),
        ),
      ),
    );
    const pi = new RexPi(session, run.block_ids[0]);
    const log = new StatusLog(pi.block, events.stdout);

    await pi.waitForScreen(FAKE_MODEL);
    await log.expect("idle");

    await scenarios.reduce(async (previous, scenario) => {
      await previous;
      console.log(`scenario: ${scenario.name}`);
      await scenario.run(sandbox, pi, log);
      console.log("  ok");
    }, Promise.resolve());
    console.log(`PASS: ${scenarios.length} scenarios, states [${log.states.join(",")}]`);
  } finally {
    events.kill();
    await rex("kill", session).catch((error: unknown) => console.error(error));
  }
};

await main();
