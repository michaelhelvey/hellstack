import { basename } from "node:path";

import {
  contentText,
  type AssistantMessage,
  type ImageContent,
  type Message,
  type SystemMessage,
  type TextContent,
  type ThinkingContent,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";

/** One source of tokens in the context window. */
export interface ContextPart {
  /** Short name of the source. */
  label: string;
  /** More information about the source, such as a file path. */
  detail?: string;
  /** Estimated tokens, after scaling to the total that pi reports. */
  tokens: number;
  /** Number of messages in the part, when the part collects more than one. */
  count?: number;
}

/** A group of context parts, such as the system prompt. */
export interface ContextSection {
  title: string;
  parts: ContextPart[];
  tokens: number;
}

/** Where the tokens in the context window are. */
export interface ContextReport {
  model?: string;
  contextWindow: number;
  totalTokens: number | null;
  percent: number | null;
  sections: ContextSection[];
  /** The largest single messages in the conversation. */
  largest: ContextPart[];
}

/** The context data that {@link buildContextReport} reads. */
export interface ContextSnapshot {
  model?: string;
  contextWindow: number;
  totalTokens: number | null;
  percent: number | null;
  system: SystemMessage | undefined;
  systemPromptFallback: string;
  messages: readonly Message[];
}

const CHARS_PER_TOKEN = 4;
const CHARS_PER_IMAGE = 4800;
const LARGEST_COUNT = 10;
const PROJECT_FILE_PATTERN =
  /<project_instructions path="([^"]*)">([\s\S]*?)<\/project_instructions>/g;
const SKILL_PATTERN = /<skill>([\s\S]*?)<\/skill>/g;
const SKILL_NAME_PATTERN = /<name>([^<]*)<\/name>/;
const ARGUMENT_KEYS = ["path", "file_path", "command", "pattern", "query", "url", "script"];
const PREVIEW_CHARS = 64;
const SECTION_LABELS: Record<string, string> = {
  preamble: "base instructions",
  tools: "tool list",
  rules: "rules",
  docs: "pi docs pointer",
  cwd: "working directory",
  addendum: "appended prompt",
};

type Bucket = { tokens: number; count: number };
type Buckets = Map<string, Bucket>;
type ToolArguments = Map<string, Record<string, unknown>>;

/** Estimates the tokens of one text, with the same characters/4 heuristic as pi. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimates the tokens of one message, with the same characters/4 heuristic as pi. */
export function estimateMessageTokens(message: Message): number {
  return message.role === "system" ? systemTokens(message) : contentMessageTokens(message);
}

/** Returns the percentage of the context window that `tokens` uses. */
export function percentOf(tokens: number, contextWindow: number): number | null {
  return contextWindow > 0 ? (tokens / contextWindow) * 100 : null;
}

/**
 * Builds the context report. The token counts of the parts are scaled to `totalTokens` when pi
 * knows the total, so that the parts agree with the total in the footer.
 */
export function buildContextReport(snapshot: ContextSnapshot): ContextReport {
  const sections = baseSections(snapshot);
  const factor = scaleFactor(sections, snapshot.totalTokens);
  const totalTokens = snapshot.totalTokens ?? sumSections(sections);

  return {
    ...(snapshot.model ? { model: snapshot.model } : {}),
    contextWindow: snapshot.contextWindow,
    totalTokens,
    percent: snapshot.percent ?? percentOf(totalTokens, snapshot.contextWindow),
    sections: scaleSections(sections, factor),
    largest: scaleParts(largestMessages(snapshot.messages), factor),
  };
}

function systemTokens(message: SystemMessage): number {
  const content = contentChars(message.content);
  const sections = Object.values(message.sections ?? {}).reduce(
    (sum, value) => sum + (value?.length ?? 0),
    0,
  );

  return Math.ceil((content + sections) / CHARS_PER_TOKEN);
}

function contentMessageTokens(message: UserMessage | AssistantMessage | ToolResultMessage): number {
  return message.role === "assistant"
    ? assistantTokens(message)
    : estimateContentTokens(message.content);
}

function assistantTokens(message: AssistantMessage): number {
  const chars = message.content.reduce((sum, block) => sum + assistantBlockChars(block), 0);

  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function assistantBlockChars(block: TextContent | ThinkingContent | ToolCall): number {
  if (block.type === "text") return block.text.length;
  if (block.type === "thinking") return block.thinking.length;

  return block.name.length + JSON.stringify(block.arguments).length;
}

function estimateContentTokens(content: string | readonly (TextContent | ImageContent)[]): number {
  return Math.ceil(contentChars(content) / CHARS_PER_TOKEN);
}

function contentChars(content: string | readonly (TextContent | ImageContent)[]): number {
  if (typeof content === "string") return content.length;

  return content.reduce((sum, block) => sum + blockChars(block), 0);
}

function blockChars(block: TextContent | ImageContent): number {
  return block.type === "text" ? block.text.length : CHARS_PER_IMAGE;
}

function baseSections(snapshot: ContextSnapshot): ContextSection[] {
  return [
    systemSection(snapshot.system, snapshot.systemPromptFallback),
    toolSection(snapshot.system?.toolsAdded),
    conversationSection(snapshot.messages),
  ].filter(isNonEmptySection);
}

function isNonEmptySection(section: ContextSection | undefined): section is ContextSection {
  return section !== undefined && section.parts.length > 0;
}

function systemSection(system: SystemMessage | undefined, fallback: string): ContextSection {
  const parts = system ? systemMessageParts(system) : fallbackParts(fallback);

  return makeSection("System prompt", parts);
}

function fallbackParts(text: string): ContextPart[] {
  return text.trim() ? [textPart("system prompt", text)] : [];
}

function systemMessageParts(system: SystemMessage): ContextPart[] {
  const content = contentText(system.content);
  const contentPart = content.trim() ? [textPart("system prompt", content)] : [];

  return [...contentPart, ...allSectionParts(system.sections)];
}

function allSectionParts(sections: SystemMessage["sections"]): ContextPart[] {
  return Object.entries(sections ?? {}).flatMap(([name, value]) =>
    value ? sectionParts(name, value) : [],
  );
}

function sectionParts(name: string, content: string): ContextPart[] {
  if (name === "project_context") return projectFileParts(content);
  if (name === "skills") return skillParts(content);

  return [textPart(labelForSection(name), content)];
}

function labelForSection(name: string): string {
  return SECTION_LABELS[name] ?? name.replaceAll("_", " ");
}

function projectFileParts(content: string): ContextPart[] {
  const parts: ContextPart[] = [];
  let rest = content;

  for (const match of content.matchAll(PROJECT_FILE_PATTERN)) {
    const path = match[1] ?? "";
    const body = match[2] ?? "";
    parts.push({ label: basename(path), detail: path, tokens: estimateTextTokens(body) });
    rest = rest.replace(match[0], "");
  }

  return withRemainder(parts, rest, "project instructions header");
}

function skillParts(content: string): ContextPart[] {
  const parts: ContextPart[] = [];
  let rest = content;

  for (const match of content.matchAll(SKILL_PATTERN)) {
    const block = match[1] ?? "";
    parts.push({ label: `skill: ${skillName(block)}`, tokens: estimateTextTokens(block) });
    rest = rest.replace(match[0], "");
  }

  return withRemainder(parts, rest, "skills list");
}

function skillName(block: string): string {
  return SKILL_NAME_PATTERN.exec(block)?.[1]?.trim() || "unnamed";
}

function withRemainder(parts: ContextPart[], text: string, label: string): ContextPart[] {
  const remainder = text.trim();

  return remainder ? [...parts, textPart(label, remainder)] : parts;
}

function textPart(label: string, text: string): ContextPart {
  return { label, tokens: estimateTextTokens(text) };
}

function toolSection(tools: readonly Tool[] | undefined): ContextSection {
  return makeSection("Tool definitions", (tools ?? []).map(toolPart));
}

function toolPart(tool: Tool): ContextPart {
  const text = JSON.stringify({ description: tool.description, parameters: tool.parameters });

  return { label: tool.name, tokens: estimateTextTokens(text) };
}

function conversationSection(messages: readonly Message[]): ContextSection {
  const buckets: Buckets = new Map();
  addMessages(messages, buckets);

  const parts = Array.from(buckets, ([label, bucket]) => ({
    label,
    tokens: bucket.tokens,
    count: bucket.count,
  }));

  return makeSection("Conversation", parts);
}

function addMessages(messages: readonly Message[], buckets: Buckets): void {
  for (const message of messages) addMessageParts(message, buckets);
}

function addMessageParts(message: Message, buckets: Buckets): void {
  if (message.role === "user") addUser(message, buckets);
  else if (message.role === "assistant") addAssistant(message, buckets);
  else if (message.role === "toolResult") addToolResult(message, buckets);
}

function addUser(message: UserMessage, buckets: Buckets): void {
  bump(buckets, "user messages", estimateContentTokens(message.content));
}

function addAssistant(message: AssistantMessage, buckets: Buckets): void {
  for (const block of message.content) addAssistantBlock(block, buckets);
}

function addAssistantBlock(
  block: TextContent | ThinkingContent | ToolCall,
  buckets: Buckets,
): void {
  if (block.type === "text") bump(buckets, "assistant text", estimateTextTokens(block.text));
  else if (block.type === "thinking")
    bump(buckets, "assistant thinking", estimateTextTokens(block.thinking));
  else
    bump(
      buckets,
      "tool call arguments",
      estimateTextTokens(block.name + JSON.stringify(block.arguments)),
    );
}

function addToolResult(message: ToolResultMessage, buckets: Buckets): void {
  bump(buckets, `tool result: ${message.toolName}`, estimateContentTokens(message.content));
}

function bump(buckets: Buckets, label: string, tokens: number): void {
  const bucket = buckets.get(label) ?? { tokens: 0, count: 0 };
  bucket.tokens += tokens;
  bucket.count += 1;
  buckets.set(label, bucket);
}

function largestMessages(messages: readonly Message[]): ContextPart[] {
  const argumentsById = toolArguments(messages);

  return messages
    .map((message) => ({
      label: describeMessage(message, argumentsById),
      tokens: estimateMessageTokens(message),
    }))
    .filter((part) => part.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, LARGEST_COUNT);
}

function toolArguments(messages: readonly Message[]): ToolArguments {
  const argumentsById: ToolArguments = new Map();

  for (const message of messages) {
    if (message.role === "assistant") addToolCalls(message, argumentsById);
  }

  return argumentsById;
}

function addToolCalls(message: AssistantMessage, argumentsById: ToolArguments): void {
  for (const block of message.content) {
    if (block.type === "toolCall") argumentsById.set(block.id, block.arguments);
  }
}

function describeMessage(message: Message, argumentsById: ToolArguments): string {
  if (message.role === "user") return `user: ${preview(contentText(message.content))}`;
  if (message.role === "assistant") return `assistant: ${preview(assistantText(message))}`;
  if (message.role === "toolResult") return describeToolResult(message, argumentsById);

  return "system prompt";
}

function assistantText(message: AssistantMessage): string {
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));

  return text.join(" ") || "(tool calls)";
}

function describeToolResult(message: ToolResultMessage, argumentsById: ToolArguments): string {
  const call = argumentsById.get(message.toolCallId);

  return call
    ? `tool result: ${message.toolName} ${describeArguments(call)}`
    : `tool result: ${message.toolName}`;
}

function describeArguments(args: Record<string, unknown>): string {
  for (const key of ARGUMENT_KEYS) {
    const value = args[key];
    if (typeof value === "string") return preview(value);
  }

  return preview(JSON.stringify(args));
}

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();

  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
}

function scaleFactor(sections: readonly ContextSection[], total: number | null): number {
  if (total === null) return 1;
  const estimate = sumSections(sections);

  return estimate > 0 ? total / estimate : 1;
}

function scaleSections(sections: readonly ContextSection[], factor: number): ContextSection[] {
  return sections.map((section) => makeSection(section.title, scaleParts(section.parts, factor)));
}

function scaleParts(parts: readonly ContextPart[], factor: number): ContextPart[] {
  return parts.map((part) => ({ ...part, tokens: Math.round(part.tokens * factor) }));
}

function makeSection(title: string, parts: ContextPart[]): ContextSection {
  return { title, parts, tokens: sumTokens(parts) };
}

function sumSections(sections: readonly ContextSection[]): number {
  return sections.reduce((sum, section) => sum + section.tokens, 0);
}

function sumTokens(parts: readonly ContextPart[]): number {
  return parts.reduce((sum, part) => sum + part.tokens, 0);
}
