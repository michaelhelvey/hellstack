import { getCurrentSystemMessage, type Message } from "@earendil-works/pi-ai";
import type { ContextUsage, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { ContextSnapshot } from "./report.ts";

type Projection = ReturnType<ExtensionCommandContext["sessionManager"]["buildSessionProjection"]>;
type ProjectionMessage = Projection["messages"][number];

const STANDARD_ROLES = new Set(["system", "user", "assistant", "toolResult"]);

function isStandardMessage(message: ProjectionMessage): message is Message {
  return STANDARD_ROLES.has(message.role);
}

function contextWindowOf(ctx: ExtensionCommandContext, usage: ContextUsage | undefined): number {
  if (usage) return usage.contextWindow;

  return ctx.model?.contextWindow ?? 0;
}

function totalTokensOf(usage: ContextUsage | undefined): number | null {
  return usage ? usage.tokens : null;
}

function percentOfUsage(usage: ContextUsage | undefined): number | null {
  return usage ? usage.percent : null;
}

/**
 * Reads the context that pi would send for the current session. The system prompt records the
 * sections and tool declarations, so the report can name the source of each part.
 */
export function readSnapshot(ctx: ExtensionCommandContext): ContextSnapshot {
  const projection = ctx.sessionManager.buildSessionProjection();
  const usage = ctx.getContextUsage();

  return {
    ...(ctx.model ? { model: ctx.model.id } : {}),
    contextWindow: contextWindowOf(ctx, usage),
    totalTokens: totalTokensOf(usage),
    percent: percentOfUsage(usage),
    system: getCurrentSystemMessage(projection.messages),
    systemPromptFallback: ctx.getSystemPrompt(),
    messages: projection.messages.filter(isStandardMessage),
  };
}
