/** Adds a focused side conversation to Pi. */

import {
  buildSessionContext,
  createAgentSession,
  createExtensionRuntime,
  SessionManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionContext,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

const ENTRY_TYPE = "btw-thread-entry";
const RESET_TYPE = "btw-thread-reset";
const BTW_PROMPT =
  "You are BTW, a focused side-channel assistant. Give direct and practical answers.";
const SUMMARY_PROMPT =
  "Summarize this side conversation for the main conversation. Output only the summary.";

type Item = { question: string; answer: string; timestamp: number };
type Runtime = { session: AgentSession; modelKey: string };
type CustomEntry = { type: "custom"; customType: string; data?: unknown };
type SideContext = ExtensionContext & { model: NonNullable<ExtensionContext["model"]> };

function answerText(content: AssistantMessage["content"]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function modelKey(ctx: SideContext): string {
  return `${ctx.model.provider}/${ctx.model.id}`;
}

function createLoader(ctx: ExtensionContext, prompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => ctx.getSystemPrompt(),
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [prompt],
    getAppendSystemPromptSources: () => [],
    extendResources: () => undefined,
    reload: () => Promise.resolve(),
  };
}

function seedContext(ctx: ExtensionContext): Message[] {
  try {
    const context = buildSessionContext(
      ctx.sessionManager.getEntries(),
      ctx.sessionManager.getLeafId(),
    );
    return context.messages.filter((message) => "role" in message) as Message[];
  } catch {
    return [];
  }
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantSeed(ctx: SideContext, item: Item): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text: item.answer }],
    provider: ctx.model.provider,
    model: ctx.model.id,
    api: "openai-responses",
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: item.timestamp,
  };
}

function seedItem(ctx: SideContext, item: Item): Message[] {
  return [
    { role: "user", content: [{ type: "text", text: item.question }], timestamp: item.timestamp },
    assistantSeed(ctx, item),
  ];
}

function transcript(items: Item[]): string {
  return items
    .map((item) => `User: ${item.question}\nAssistant: ${item.answer}`)
    .join("\n\n---\n\n");
}

class BtwExtension {
  private readonly pi: ExtensionAPI;
  private items: Item[] = [];
  private side: Runtime | null = null;
  private busy = false;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  private notify(
    ctx: ExtensionContext,
    message: string,
    type: "info" | "warning" | "error" = "info",
  ): void {
    if (ctx.hasUI) ctx.ui.notify(message, type);
  }

  private resetIndex(branch: CustomEntry[]): number {
    return branch.reduce(
      (index, entry, current) => (entry.customType === RESET_TYPE ? current : index),
      -1,
    );
  }

  private restore(ctx: ExtensionContext): void {
    this.items = [];
    const branch = ctx.sessionManager.getBranch() as CustomEntry[];
    for (const entry of branch.slice(this.resetIndex(branch) + 1)) this.restoreEntry(entry);
  }

  private restoreEntry(entry: CustomEntry): void {
    if (entry.customType !== ENTRY_TYPE) return;
    const value = entry.data as Item | undefined;
    if (value?.question && value.answer) this.items.push(value);
  }

  private lastAssistant(session: AgentSession): AssistantMessage | undefined {
    return [...session.state.messages]
      .reverse()
      .find((message): message is AssistantMessage => message.role === "assistant");
  }

  private async dispose(): Promise<void> {
    const current = this.side;
    this.side = null;
    if (!current) return;
    try {
      await current.session.abort();
    } catch {
      /* The session may already be idle. */
    }
    current.session.dispose();
  }

  private async createSide(ctx: SideContext, prompt: string): Promise<Runtime> {
    const created = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model: ctx.model,
      thinkingLevel: this.pi.getThinkingLevel(),
      tools: ["read", "bash", "edit", "write"],
      resourceLoader: createLoader(ctx, prompt),
    });
    created.session.agent.state.messages = [
      ...seedContext(ctx),
      ...this.items.flatMap((item) => seedItem(ctx, item)),
    ];
    return { session: created.session, modelKey: modelKey(ctx) };
  }

  private async ensureSide(ctx: SideContext, prompt: string): Promise<Runtime> {
    if (this.side?.modelKey === modelKey(ctx)) return this.side;
    await this.dispose();
    this.side = await this.createSide(ctx, prompt);
    return this.side;
  }

  private async completeAsk(ctx: SideContext, question: string): Promise<void> {
    const runtime = await this.ensureSide(ctx, BTW_PROMPT);
    await runtime.session.prompt(question, { source: "extension" });
    const answer = this.answer(runtime.session);
    if (!answer) throw new Error("BTW returned no text");
    const item = { question, answer, timestamp: Date.now() };
    this.items.push(item);
    this.pi.appendEntry(ENTRY_TYPE, item);
    this.notify(ctx, answer);
  }

  private async ask(ctx: SideContext, question: string): Promise<void> {
    if (this.busy)
      return this.notify(ctx, "BTW is still processing the previous question.", "warning");
    this.busy = true;
    try {
      await this.completeAsk(ctx, question);
    } catch (error) {
      this.notify(ctx, error instanceof Error ? error.message : String(error), "error");
    } finally {
      this.busy = false;
    }
  }

  private answer(session: AgentSession): string {
    return answerText(this.lastAssistant(session)?.content ?? []);
  }

  private async runSummary(ctx: SideContext, session: AgentSession): Promise<void> {
    await session.prompt(transcript(this.items), { source: "extension" });
    const answer = this.answer(session);
    if (!answer) throw new Error("BTW returned no summary");
    this.pi.sendUserMessage(`Summary of my BTW side conversation:\n\n${answer}`);
    await this.reset(ctx);
  }

  private async summarize(ctx: SideContext): Promise<void> {
    if (this.items.length === 0) return this.notify(ctx, "No BTW thread to summarize.", "warning");
    const temporary = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model: ctx.model,
      thinkingLevel: "off",
      tools: [],
      resourceLoader: createLoader(ctx, SUMMARY_PROMPT),
    });
    try {
      await this.runSummary(ctx, temporary.session);
    } finally {
      temporary.session.dispose();
    }
  }

  private async reset(ctx: ExtensionContext): Promise<void> {
    this.items = [];
    await this.dispose();
    this.pi.appendEntry(RESET_TYPE, { timestamp: Date.now() });
    this.notify(ctx, "BTW thread reset.");
  }

  private async promptCommand(ctx: SideContext): Promise<void> {
    if (!ctx.hasUI)
      return this.notify(ctx, "Use /btw <question> in non-interactive mode.", "warning");
    const question = await ctx.ui.input("BTW question:");
    if (question?.trim()) await this.ask(ctx, question.trim());
  }

  private async command(args: string, ctx: ExtensionContext): Promise<void> {
    if (!ctx.model) return this.notify(ctx, "No active model selected.", "error");
    return this.route(args.trim(), ctx as SideContext, ctx);
  }

  private async route(value: string, ctx: SideContext, base: ExtensionContext): Promise<void> {
    switch (value) {
      case "reset":
        return this.reset(base);
      case "summary":
        return this.summarize(ctx);
      case "":
        return this.promptCommand(ctx);
      default:
        return this.ask(ctx, value);
    }
  }

  register(): void {
    this.pi.registerCommand("btw", {
      description: "Ask a focused question in a separate BTW conversation.",
      getArgumentCompletions: (prefix) =>
        ["reset", "summary"]
          .filter((value) => value.startsWith(prefix))
          .map((value) => ({ value, label: value })),
      handler: (args, ctx) => this.command(args, ctx),
    });
    this.pi.on("session_start", (_event, ctx) => this.restore(ctx));
    this.pi.on("session_tree", (_event, ctx) => this.restore(ctx));
    this.pi.on("session_shutdown", () => this.dispose());
  }
}

export default function btwExtension(pi: ExtensionAPI): void {
  new BtwExtension(pi).register();
}
