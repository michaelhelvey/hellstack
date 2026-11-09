import { z } from "zod";

const RequestSchema = z.looseObject({
  messages: z.array(z.looseObject({ role: z.string(), content: z.unknown() })),
});

/** A chat completions request that pi sent to the fake model. */
export type FakeRequest = z.infer<typeof RequestSchema>;

/** One tool call that the fake model asks pi to run. */
export interface FakeToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** One scripted reply of the fake model: text, or tool calls. */
export type FakeReply =
  | { readonly text: string }
  | { readonly toolCalls: ReadonlyArray<FakeToolCall> };

/** The name of the fake provider in `models.json`. */
export const FAKE_PROVIDER = "fake";

/** The id of the fake model in `models.json`. */
export const FAKE_MODEL = "fake-1";

const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => {
  const choice = { index: 0, delta, finish_reason: finishReason };
  const record = { id: "fake", object: "chat.completion.chunk", created: 0, model: FAKE_MODEL };
  return `data: ${JSON.stringify({ ...record, choices: [choice] })}\n\n`;
};

const toolCallChunk = (call: FakeToolCall, index: number) =>
  chunk({
    role: "assistant",
    tool_calls: [
      {
        index,
        id: `call_${index}`,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      },
    ],
  });

const toSse = (reply: FakeReply) => {
  const body =
    "text" in reply
      ? chunk({ role: "assistant", content: reply.text }) + chunk({}, "stop")
      : reply.toolCalls.map(toolCallChunk).join("") + chunk({}, "tool_calls");
  return `${body}data: [DONE]\n\n`;
};

/**
 * A local server that acts as an OpenAI chat completions endpoint. Tests script the replies.
 */
export class FakeModel {
  /** The requests that pi sent, in order. */
  readonly requests: Array<FakeRequest> = [];
  readonly #replies: Array<FakeReply> = [];
  readonly #server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      this.requests.push(RequestSchema.parse(await request.json()));
      const reply = this.#replies.shift() ?? { text: "The fake model has no scripted reply." };
      return new Response(toSse(reply), { headers: { "content-type": "text/event-stream" } });
    },
  });

  /** The provider entry for `models.json`. */
  get provider() {
    return {
      baseUrl: `http://127.0.0.1:${this.#server.port}/v1`,
      api: "openai-completions",
      apiKey: "fake",
      models: [{ id: FAKE_MODEL }],
    };
  }

  /** Adds text replies. */
  reply(...texts: Array<string>): void {
    this.#replies.push(...texts.map((text) => ({ text })));
  }

  /** Adds a reply with the tool calls, and then a final text reply. */
  callTools(...calls: Array<FakeToolCall>): void {
    this.#replies.push({ toolCalls: calls }, { text: "Done." });
  }

  /** Stops the server. */
  stop(): Promise<void> {
    return this.#server.stop(true);
  }
}
