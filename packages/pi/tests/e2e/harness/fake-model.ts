import { z } from "zod";

/** One tool call that the fake model asks pi to run. */
export interface FakeToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** One scripted reply of the fake model: text, or tool calls. `delayMs` delays the reply. */
export type FakeReply =
  { text: string; delayMs?: number } | { toolCalls: FakeToolCall[]; delayMs?: number };

/** A reply, or a function that makes the reply from the request that pi sent. */
export type FakeReplyStep = FakeReply | ((request: ChatRequest) => FakeReply);

const ChatMessage = z.looseObject({
  role: z.string(),
  content: z.unknown().optional(),
  tool_call_id: z.string().optional(),
});

const ChatRequestSchema = z.looseObject({
  messages: z.array(ChatMessage),
  tools: z
    .array(z.looseObject({ function: z.looseObject({ name: z.string() }) }))
    .optional()
    .default([]),
});

/** A chat completions request that pi sent to the fake model. */
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** The name of the fake provider in `models.json`. */
export const FAKE_PROVIDER = "fake";

/** The id of the fake model in `models.json`. */
export const FAKE_MODEL = "fake-1";

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  const choice = { index: 0, delta, finish_reason: finishReason };
  const record = { id: "fake", object: "chat.completion.chunk", created: 0, model: FAKE_MODEL };
  return `data: ${JSON.stringify({ ...record, choices: [choice] })}\n\n`;
}

function toolCallChunk(call: FakeToolCall, index: number): string {
  const fn = { name: call.name, arguments: JSON.stringify(call.arguments) };
  const toolCall = { index, id: `call_${index}`, type: "function", function: fn };
  return chunk({ role: "assistant", tool_calls: [toolCall] });
}

function toSse(reply: FakeReply): string {
  const body =
    "text" in reply
      ? chunk({ role: "assistant", content: reply.text }) + chunk({}, "stop")
      : reply.toolCalls.map(toolCallChunk).join("") + chunk({}, "tool_calls");
  return `${body}data: [DONE]\n\n`;
}

/**
 * A local server that acts as an OpenAI chat completions endpoint. Tests script the replies, and
 * the server records each request that pi sends.
 */
export class FakeModel {
  /** The requests that pi sent, in order. */
  readonly requests: ChatRequest[] = [];
  readonly #steps: FakeReplyStep[] = [];
  readonly #server: Bun.Server<undefined>;

  constructor() {
    this.#server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => this.#handle(request),
    });
  }

  /** The base URL for `models.json`. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.#server.port}/v1`;
  }

  /** Adds replies to the end of the script. */
  reply(...steps: FakeReplyStep[]): void {
    this.#steps.push(...steps);
  }

  /** Adds a reply with the tool calls, and then a final text reply. */
  callTools(...calls: FakeToolCall[]): void {
    this.reply({ toolCalls: calls }, { text: "Done." });
  }

  /** Stops the server. */
  async stop(): Promise<void> {
    await this.#server.stop(true);
  }

  async #handle(request: Request): Promise<Response> {
    const parsed = ChatRequestSchema.parse(await request.json());
    this.requests.push(parsed);
    const reply = this.#nextReply(parsed);
    if (reply.delayMs) await Bun.sleep(reply.delayMs);
    return new Response(toSse(reply), { headers: { "content-type": "text/event-stream" } });
  }

  #nextReply(request: ChatRequest): FakeReply {
    const step = this.#steps.shift() ?? { text: "The fake model has no scripted reply." };
    return typeof step === "function" ? step(request) : step;
  }
}

/** Returns the text of the last tool result in a request. */
export function lastToolResult(request: ChatRequest): string {
  const message = request.messages.findLast((m) => m.role === "tool");
  return z.string().parse(message?.content);
}
