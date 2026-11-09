import { z } from "zod";

const TIMEOUT_MS = 20_000;

const RecordSchema = z.looseObject({ type: z.string(), id: z.string().optional() });

type RpcRecord = z.infer<typeof RecordSchema>;

const UiRequestSchema = z.looseObject({
  type: z.literal("extension_ui_request"),
  id: z.string(),
  method: z.string(),
  title: z.string().optional(),
  options: z.array(z.string()).optional(),
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
    content: z.array(z.looseObject({ text: z.string().optional() })),
    details: z.unknown().optional(),
  }),
});

/** The result of one tool call, as pi reported it. */
export interface ToolResult {
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean;
  readonly details: unknown;
}

const toolResult = (record: RpcRecord): Array<ToolResult> => {
  const parsed = ToolEndSchema.safeParse(record);
  if (!parsed.success) return [];
  const { toolName, isError, result } = parsed.data;
  const text = result.content.map((block) => block.text ?? "").join("\n");
  return [{ toolName, text, isError, details: result.details }];
};

const timeout = (what: string) =>
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), TIMEOUT_MS);
  });

/**
 * Runs pi in RPC mode (`--mode rpc`), and talks to it with JSON lines on stdin and stdout. Answers
 * extension dialogs with the handler from `onDialog`, or cancels them.
 */
export class RpcPi {
  readonly #records: Array<RpcRecord> = [];
  readonly #listeners = new Set<(record: RpcRecord) => void>();
  readonly #proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  readonly #stderr: Promise<string>;
  #dialog: (request: UiRequest) => UiAnswer = () => ({ cancelled: true });

  constructor(cmd: Array<string>, cwd: string, env: Record<string, string>) {
    this.#proc = Bun.spawn([...cmd, "--mode", "rpc"], {
      cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.#stderr = new Response(this.#proc.stderr).text();
    void this.#read();
  }

  /** Sets the function that answers extension dialogs. */
  onDialog(handler: (request: UiRequest) => UiAnswer): void {
    this.#dialog = handler;
  }

  /** Sends a prompt, waits until pi settles, and returns the results of the tool calls. */
  async prompt(message: string): Promise<Array<ToolResult>> {
    const start = this.#records.length;
    const settled = this.#waitFor((r) => r.type === "agent_settled", "agent_settled");
    const response = this.#waitFor((r) => r.type === "response" && r.id === "prompt", "response");
    this.#send({ type: "prompt", id: "prompt", message });
    await response;
    await settled;
    return this.#records.slice(start).flatMap(toolResult);
  }

  /** Closes stdin and stops pi. */
  async stop(): Promise<void> {
    await this.#proc.stdin.end();
    await Promise.race([this.#proc.exited, Bun.sleep(5000)]);
    this.#proc.kill();
  }

  #send(record: Record<string, unknown>): void {
    void this.#proc.stdin.write(`${JSON.stringify(record)}\n`);
    void this.#proc.stdin.flush();
  }

  async #read(): Promise<void> {
    let buffer = "";
    for await (const text of this.#proc.stdout.pipeThrough(new TextDecoderStream())) {
      const lines = (buffer + text).split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter((l) => l.trim()))
        this.#onRecord(RecordSchema.parse(JSON.parse(line)));
    }
  }

  #onRecord(record: RpcRecord): void {
    this.#records.push(record);
    const request = UiRequestSchema.safeParse(record);
    if (request.success && DIALOG_METHODS.has(request.data.method)) {
      this.#send({
        type: "extension_ui_response",
        id: request.data.id,
        ...this.#dialog(request.data),
      });
    }
    for (const listener of this.#listeners) listener(record);
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
    return Promise.race([found, this.#exited(what), timeout(what)]);
  }

  async #exited(what: string): Promise<never> {
    const code = await this.#proc.exited;
    throw new Error(`pi exited with code ${code} before ${what}. stderr:\n${await this.#stderr}`);
  }
}
