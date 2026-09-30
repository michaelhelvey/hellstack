import { z } from "zod";

import { readLines, readText } from "./lines.ts";

const TIMEOUT_MS = 20_000;

const RpcRecordSchema = z.looseObject({ type: z.string(), id: z.string().optional() });

/** One JSON record that pi wrote to stdout in RPC mode. */
export type RpcRecord = z.infer<typeof RpcRecordSchema>;

const RpcResponseSchema = z.looseObject({
  type: z.literal("response"),
  command: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  data: z.unknown().optional(),
});

/** The response of pi to one RPC command. */
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

const UiRequestSchema = z.looseObject({
  type: z.literal("extension_ui_request"),
  id: z.string(),
  method: z.string(),
  title: z.string().optional(),
  message: z.string().optional(),
});

/** A dialog or notification that an extension shows through `ctx.ui`. */
export type UiRequest = z.infer<typeof UiRequestSchema>;

/** The answer to a dialog: a value, a confirmation, or a cancellation. */
export type UiAnswer = { value: string } | { confirmed: boolean } | { cancelled: true };

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

const ToolEndSchema = z.looseObject({
  type: z.literal("tool_execution_end"),
  toolName: z.string(),
  isError: z.boolean(),
  result: z.looseObject({
    content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
    details: z.unknown().optional(),
  }),
});

/** The result of one tool call, as pi reported it. */
export interface ToolResult {
  toolName: string;
  text: string;
  isError: boolean;
  details: unknown;
}

function toToolResult(record: z.infer<typeof ToolEndSchema>): ToolResult {
  const text = record.result.content.map((block) => block.text ?? "").join("\n");
  return {
    toolName: record.toolName,
    text,
    isError: record.isError,
    details: record.result.details,
  };
}

/** The records of one prompt, from the prompt command to `agent_settled`. */
export class Run {
  constructor(readonly records: RpcRecord[]) {}

  /** Returns the results of the tool calls in this run, in order. */
  toolResults(): ToolResult[] {
    return this.records.flatMap((record) => {
      const parsed = ToolEndSchema.safeParse(record);
      return parsed.success ? [toToolResult(parsed.data)] : [];
    });
  }
}

function timeout(ms: number, what: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for ${what}`)), ms);
  });
}

/** The command and environment to start pi with. */
export interface PiCommand {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * Runs pi in RPC mode (`--mode rpc`) and talks to it with JSONL records on stdin and stdout.
 * Answers extension dialogs with the handler from `onDialog`, or cancels them.
 */
export class RpcPi {
  /** All records that pi wrote to stdout. */
  readonly records: RpcRecord[] = [];
  /** All dialogs and notifications that extensions showed. */
  readonly uiRequests: UiRequest[] = [];
  readonly #proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  readonly #listeners = new Set<(record: RpcRecord) => void>();
  readonly #stderr: Promise<string>;
  #dialogHandler: (request: UiRequest) => UiAnswer = () => ({ cancelled: true });
  #nextId = 0;

  private constructor(command: PiCommand) {
    this.#proc = Bun.spawn([...command.cmd, "--mode", "rpc"], {
      cwd: command.cwd,
      env: command.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.#stderr = readText(this.#proc.stderr);
    void readLines(this.#proc.stdout, (line) => this.#onLine(line));
  }

  /** Starts pi and waits until it answers a command. */
  static async start(command: PiCommand): Promise<RpcPi> {
    const pi = new RpcPi(command);
    await pi.request({ type: "get_state" });
    return pi;
  }

  /** Sets the function that answers extension dialogs. */
  onDialog(handler: (request: UiRequest) => UiAnswer): void {
    this.#dialogHandler = handler;
  }

  /** Sends one command and returns the response. Throws if the command fails. */
  async request(command: Record<string, unknown>): Promise<RpcResponse> {
    const id = `req-${this.#nextId++}`;
    const record = this.#waitFor((r) => r.type === "response" && r.id === id, `response ${id}`);
    this.#send({ ...command, id });
    const response = RpcResponseSchema.parse(await record);
    if (!response.success) throw new Error(`${response.command} failed: ${response.error}`);
    return response;
  }

  /** Returns the id of the current pi session. */
  async sessionId(): Promise<string> {
    const { data } = await this.request({ type: "get_state" });
    return z.object({ sessionId: z.string() }).parse(data).sessionId;
  }

  /** Sends a prompt and waits until pi settles. Throws if an extension reported an error. */
  async prompt(message: string): Promise<Run> {
    const start = this.records.length;
    const settled = this.#waitFor((r) => r.type === "agent_settled", "agent_settled");
    await this.request({ type: "prompt", message });
    await settled;
    const run = new Run(this.records.slice(start));
    const errors = run.records.filter((r) => r.type === "extension_error");
    if (errors.length > 0) throw new Error(`Extension errors: ${JSON.stringify(errors)}`);
    return run;
  }

  /** Waits for the next dialog or notification with the method, for example `notify`. */
  async nextUiRequest(method: string): Promise<UiRequest> {
    const record = await this.#waitFor(
      (r) => r.type === "extension_ui_request" && r["method"] === method,
      `extension_ui_request ${method}`,
    );
    return UiRequestSchema.parse(record);
  }

  /** Closes stdin, waits for pi to exit, and returns what pi wrote to stderr. */
  async stop(): Promise<string> {
    await this.#proc.stdin.end();
    await Promise.race([this.#proc.exited, Bun.sleep(5000)]);
    this.#proc.kill();
    return this.#stderr;
  }

  #send(record: Record<string, unknown>): void {
    void this.#proc.stdin.write(`${JSON.stringify(record)}\n`);
    void this.#proc.stdin.flush();
  }

  #onLine(line: string): void {
    if (!line.trim()) return;
    const record = RpcRecordSchema.parse(JSON.parse(line));
    this.records.push(record);
    this.#answerUiRequest(record);
    for (const listener of this.#listeners) listener(record);
  }

  #answerUiRequest(record: RpcRecord): void {
    const parsed = UiRequestSchema.safeParse(record);
    if (!parsed.success) return;
    this.uiRequests.push(parsed.data);
    if (!DIALOG_METHODS.has(parsed.data.method)) return;
    const answer = this.#dialogHandler(parsed.data);
    this.#send({ type: "extension_ui_response", id: parsed.data.id, ...answer });
  }

  #waitFor(match: (record: RpcRecord) => boolean, what: string): Promise<RpcRecord> {
    const found = new Promise<RpcRecord>((resolve) => {
      const listener = (record: RpcRecord) => {
        if (!match(record)) return;
        this.#listeners.delete(listener);
        resolve(record);
      };
      this.#listeners.add(listener);
    });
    return Promise.race([found, this.#exitedEarly(what), timeout(TIMEOUT_MS, what)]);
  }

  async #exitedEarly(what: string): Promise<never> {
    const code = await this.#proc.exited;
    const stderr = await this.#stderr;
    throw new Error(`pi exited with code ${code} before ${what}. stderr:\n${stderr}`);
  }
}
