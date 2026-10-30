import { readFile } from "node:fs/promises";

import { z } from "zod";

import { parseJsonOrUndefined } from "../shared/json.ts";
import type { SubagentMessage } from "./provider.ts";

const ContentSchema = z.union([
  z.string(),
  z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
]);

const MessageEntrySchema = z.object({
  type: z.literal("message"),
  timestamp: z.string(),
  message: z.object({ role: z.enum(["user", "assistant"]), content: ContentSchema }).loose(),
});

type MessageEntry = z.infer<typeof MessageEntrySchema>;

const MissingFileSchema = z.object({ code: z.literal("ENOENT") });

function contentText(content: MessageEntry["message"]["content"]): string {
  if (typeof content === "string") return content;

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function toMessage(line: string): SubagentMessage[] {
  const entry = MessageEntrySchema.safeParse(parseJsonOrUndefined(line));

  if (!entry.success) return [];
  const text = contentText(entry.data.message.content).trim();

  if (text === "") return [];
  const from = entry.data.message.role === "user" ? "parent" : "subagent";

  return [{ from, text, at: Date.parse(entry.data.timestamp) }];
}

/**
 * Reads the text messages of a pi session file. User messages come from the parent agent, and
 * assistant messages come from the subagent. It skips messages that have only tool calls. A
 * session file that does not exist yet has no messages.
 */
export async function readSessionMessages(path: string): Promise<SubagentMessage[]> {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (MissingFileSchema.safeParse(error).success) return "";
    throw error;
  });

  return text.split("\n").flatMap(toMessage);
}
