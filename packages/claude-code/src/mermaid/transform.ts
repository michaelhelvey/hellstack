import type { MermaidArt } from "grok-mermaid";

/** Converts Mermaid source to Unicode art. Returns `null` when it cannot draw the source. */
export type MermaidRenderer = (source: string) => MermaidArt | null;

interface Fence {
  marker: string;
  isMermaid: boolean;
  isClosed: boolean;
  lines: string[];
}

type Segment = string | Fence;

/** Matches an opening fence. The info string of a backtick fence cannot hold a backtick. */
const fencePattern = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})(.*)$/;

function language(info: string): string | undefined {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase();
}

function openFence(line: string): Fence | undefined {
  const match = fencePattern.exec(line);
  if (match === null) return undefined;
  const [, marker = "", info = ""] = match;
  return { marker, isMermaid: language(info) === "mermaid", isClosed: false, lines: [line] };
}

function closesFence(fence: Fence, line: string): boolean {
  const trimmed = line.trim();
  const char = fence.marker.charAt(0);
  return trimmed.length >= fence.marker.length && trimmed === char.repeat(trimmed.length);
}

function startSegment(segments: Segment[], line: string): Fence | undefined {
  const opened = openFence(line);
  segments.push(opened ?? line);
  return opened;
}

function continueFence(fence: Fence, line: string): Fence | undefined {
  fence.lines.push(line);
  fence.isClosed = closesFence(fence, line);
  return fence.isClosed ? undefined : fence;
}

function addLine(segments: Segment[], fence: Fence | undefined, line: string): Fence | undefined {
  return fence === undefined ? startSegment(segments, line) : continueFence(fence, line);
}

function split(markdown: string): Segment[] {
  const segments: Segment[] = [];
  let fence: Fence | undefined;
  for (const line of markdown.split("\n")) fence = addLine(segments, fence, line);
  return segments;
}

function longestBacktickRun(line: string): number {
  return Math.max(0, ...Array.from(line.matchAll(/`+/g), (match) => match[0].length));
}

function codeBlock(lines: string[]): string {
  const fence = "`".repeat(Math.max(3, ...lines.map(longestBacktickRun)) + 1);
  return [fence, ...lines, fence].join("\n");
}

function fenceBody(fence: Fence): string[] {
  return fence.lines.slice(1, fence.isClosed ? -1 : undefined);
}

function drawFence(fence: Fence, render: MermaidRenderer, width: number): string {
  const raw = fence.lines.join("\n");
  if (!fence.isMermaid) return raw;
  const art = render(fenceBody(fence).join("\n"));
  return art !== null && art.width <= width ? codeBlock(art.plain) : raw;
}

/**
 * Replaces each top-level Mermaid code block in `markdown` with a code block that holds the
 * diagram as Unicode art. A code block that is not closed (a reply that streams) is also drawn.
 * When the art is wider than `width`, or `render` cannot draw it, the source stays.
 */
export function drawMermaid(markdown: string, render: MermaidRenderer, width: number): string {
  if (!markdown.includes("mermaid")) return markdown;
  return split(markdown)
    .map((segment) => (typeof segment === "string" ? segment : drawFence(segment, render, width)))
    .join("\n");
}
