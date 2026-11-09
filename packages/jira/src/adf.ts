import { Option, Schema } from "effect";

/** One node of an Atlassian Document Format (ADF) document. */
export interface AdfNode {
  readonly type: string;
  readonly text?: string | undefined;
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
  readonly marks?: ReadonlyArray<AdfMark> | undefined;
  readonly content?: ReadonlyArray<AdfNode> | undefined;
}

interface AdfMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
}

const Attrs = Schema.Record(Schema.String, Schema.Unknown);

const AdfMarkSchema = Schema.Struct({ type: Schema.String, attrs: Schema.optional(Attrs) });

/** The schema of an ADF node. Unknown properties are ignored. */
export const AdfNodeSchema: Schema.Codec<AdfNode> = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  attrs: Schema.optional(Attrs),
  marks: Schema.optional(Schema.Array(AdfMarkSchema)),
  content: Schema.optional(Schema.Array(Schema.suspend(() => AdfNodeSchema))),
});

const decodeNode = Schema.decodeUnknownOption(AdfNodeSchema);

const attr = (
  node: { readonly attrs?: Readonly<Record<string, unknown>> | undefined },
  name: string,
) => {
  const value = node.attrs?.[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

const children = (node: AdfNode) => node.content ?? [];

const inline = (node: AdfNode): string => children(node).map(renderInline).join("");

const MARKS: Readonly<Record<string, (text: string, mark: AdfMark) => string>> = {
  code: (text) => `\`${text}\``,
  strong: (text) => `**${text}**`,
  em: (text) => `_${text}_`,
  strike: (text) => `~~${text}~~`,
  link: (text, mark) => `[${text}](${attr(mark, "href")})`,
};

const markText = (node: AdfNode) =>
  (node.marks ?? []).reduce(
    (text, mark) => MARKS[mark.type]?.(text, mark) ?? text,
    node.text ?? "",
  );

const timestampDate = (node: AdfNode) => {
  const time = Number(attr(node, "timestamp"));
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";
};

const INLINE: Readonly<Record<string, (node: AdfNode) => string>> = {
  text: markText,
  hardBreak: () => "\n",
  mention: (node) => {
    const name = attr(node, "text");
    return name.startsWith("@") ? name : `@${name}`;
  },
  emoji: (node) => attr(node, "text") || attr(node, "shortName"),
  inlineCard: (node) => attr(node, "url"),
  date: timestampDate,
  status: (node) => `[${attr(node, "text")}]`,
};

const renderInline = (node: AdfNode): string => INLINE[node.type]?.(node) ?? inline(node);

const indent = (text: string, prefix: string, rest = " ".repeat(prefix.length)) =>
  text
    .split("\n")
    .map((line, index) => (index === 0 ? prefix : rest) + line)
    .join("\n");

const blocks = (node: AdfNode, separator = "\n\n"): string =>
  children(node)
    .map(renderBlock)
    .filter((text) => text !== "")
    .join(separator);

const list = (node: AdfNode, marker: (index: number) => string) =>
  children(node)
    .map((item, index) => indent(blocks(item, "\n"), marker(index)))
    .join("\n");

const quote = (node: AdfNode) => indent(blocks(node), "> ", "> ");

const cell = (node: AdfNode) => blocks(node, "\n").replaceAll("\n", "<br>").replaceAll("|", "\\|");

const table = (node: AdfNode) => {
  const rows = children(node).map((row) => `| ${children(row).map(cell).join(" | ")} |`);
  const width = children(children(node)[0] ?? { type: "tableRow" }).length;
  const divider = `|${" --- |".repeat(width)}`;
  return [rows[0] ?? "", divider, ...rows.slice(1)].join("\n");
};

const BLOCKS: Readonly<Record<string, (node: AdfNode) => string>> = {
  paragraph: inline,
  heading: (node) => `${"#".repeat(Number(attr(node, "level")) || 1)} ${inline(node)}`,
  bulletList: (node) => list(node, () => "- "),
  orderedList: (node) => list(node, (index) => `${index + 1}. `),
  taskList: (node) => list(node, () => "- "),
  taskItem: (node) => `[${attr(node, "state") === "DONE" ? "x" : " "}] ${inline(node)}`,
  codeBlock: (node) => `\`\`\`${attr(node, "language")}\n${inline(node)}\n\`\`\``,
  blockquote: quote,
  panel: quote,
  rule: () => "---",
  table,
  mediaSingle: () => "[media]",
  mediaGroup: () => "[media]",
};

const renderBlock = (node: AdfNode): string =>
  BLOCKS[node.type]?.(node) ?? (node.content ? blocks(node) : renderInline(node));

/**
 * Changes an ADF document (for example an issue description) to Markdown text. It gives an empty
 * string for a value that is not an ADF node, and the value itself for a plain string.
 */
export const adfToText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Option.match(decodeNode(value), {
        onNone: () => "",
        onSome: (node) => renderBlock(node).trim(),
      });

const lineNodes = (line: string, index: number): ReadonlyArray<AdfNode> => {
  const breaks: ReadonlyArray<AdfNode> = index === 0 ? [] : [{ type: "hardBreak" }];
  return line === "" ? breaks : breaks.concat({ type: "text", text: line });
};

const paragraph = (text: string): AdfNode => ({
  type: "paragraph",
  content: text.split("\n").flatMap(lineNodes),
});

/**
 * Changes plain text to an ADF document. Blank lines separate paragraphs, and other line breaks
 * become hard breaks.
 */
export const textToAdf = (text: string): AdfNode & { readonly version: 1 } => ({
  type: "doc",
  version: 1,
  content: text
    .trim()
    .split(/\n{2,}/)
    .map(paragraph),
});
