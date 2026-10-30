import { z } from "zod";

/** The kind of one transcript item. */
export type TranscriptRole = "user" | "assistant" | "tool" | "summary";

/** One readable item of a session transcript. */
export type TranscriptItem = {
  entryId: string;
  timestamp: string;
  role: TranscriptRole;
  text: string;
};

/** Options that control which items a transcript contains. */
export interface TranscriptOptions {
  /** Include tool calls and tool results. */
  includeTools: boolean;
  /** The maximum number of characters for the text of one item. */
  maxChars: number;
}

const TOOL_ARGS_MAX_CHARS = 300;

const Block = z.union([
  z
    .object({ type: z.literal("text"), text: z.string() })
    .transform(({ text }) => ({ toolCall: false, text })),
  z
    .object({ type: z.literal("toolCall"), name: z.string(), arguments: z.unknown() })
    .transform((call) => ({
      toolCall: true,
      text: `[tool call] ${call.name} ${truncate(JSON.stringify(call.arguments ?? {}), TOOL_ARGS_MAX_CHARS)}`,
    })),
  z.looseObject({ type: z.string() }).transform(() => ({ toolCall: false, text: "" })),
]);

const Content = z.union([z.string(), z.array(Block)]);

const Message = z.looseObject({
  role: z.string(),
  content: Content.default(""),
  toolName: z.string().default("tool"),
  isError: z.boolean().default(false),
});

const EntryBase = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  timestamp: z.string(),
});

const Entry = z.union([
  EntryBase.extend({ type: z.literal("message"), message: Message }),
  EntryBase.extend({ type: z.enum(["compaction", "branch_summary"]), summary: z.string() }),
  EntryBase.extend({ type: z.string() }),
]);

/** One parsed session entry. Entries that do not have a known shape are not included. */
export type ParsedEntry = z.infer<typeof Entry>;

type MessageEntry = Extract<ParsedEntry, { type: "message" }>;

type ContentBlock = z.infer<typeof Block>;

/** Parses the entries of a session file. The header and entries with a bad shape are skipped. */
export function parseEntries(raw: readonly unknown[]): ParsedEntry[] {
  return raw.flatMap((value) => {
    const result = Entry.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

/** Returns the entries on the path from the root to the last entry, which is the active branch. */
export function activeBranch(entries: readonly ParsedEntry[]): ParsedEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: ParsedEntry[] = [];
  let entry = entries.at(-1);
  while (entry) {
    branch.push(entry);
    entry = entry.parentId === null ? undefined : byId.get(entry.parentId);
  }
  return branch.reverse();
}

/** Converts session entries to readable transcript items. */
export function toTranscript(
  entries: readonly ParsedEntry[],
  options: TranscriptOptions,
): TranscriptItem[] {
  return entries.flatMap((entry) => {
    const item = toItem(entry, options);
    return item && item.text ? [{ ...item, text: truncate(item.text, options.maxChars) }] : [];
  });
}

function toItem(entry: ParsedEntry, options: TranscriptOptions): TranscriptItem | undefined {
  const base = { entryId: entry.id, timestamp: entry.timestamp };
  if ("summary" in entry) return { ...base, role: "summary", text: entry.summary };
  if (!("message" in entry)) return undefined;
  const item = messageItem(entry.message, options.includeTools);
  return item && { ...base, ...item };
}

type MessageItem = Pick<TranscriptItem, "role" | "text">;

const MESSAGE_ITEMS: Record<
  string,
  (message: MessageEntry["message"], includeTools: boolean) => MessageItem | undefined
> = {
  user: (message) => ({ role: "user", text: contentText(message.content, false) }),
  assistant: (message, includeTools) => ({
    role: "assistant",
    text: contentText(message.content, includeTools),
  }),
  toolResult: (message, includeTools) => (includeTools ? toolResultItem(message) : undefined),
};

function messageItem(
  message: MessageEntry["message"],
  includeTools: boolean,
): MessageItem | undefined {
  return MESSAGE_ITEMS[message.role]?.(message, includeTools);
}

function toolResultItem(message: MessageEntry["message"]): MessageItem {
  const status = message.isError ? " (error)" : "";
  return {
    role: "tool",
    text: `${message.toolName}${status}: ${contentText(message.content, false)}`,
  };
}

function contentText(content: z.infer<typeof Content>, includeToolCalls: boolean): string {
  if (typeof content === "string") return content.trim();
  return content
    .map((block) => blockText(block, includeToolCalls))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function blockText(block: ContentBlock, includeToolCalls: boolean): string {
  return block.toolCall && !includeToolCalls ? "" : block.text;
}

/** Shortens text to `maxChars` characters and adds a marker that tells how many were removed. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… [${text.length - maxChars} more chars]`;
}
