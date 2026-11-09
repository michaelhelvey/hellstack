import { type ChildNode, type Element, isCDATA, isTag, isText } from "domhandler";
import { DomUtils, parseDocument } from "htmlparser2";

/** A "mermaid-cloud" diagram on a page. Its source is in a page attachment. */
export interface Diagram {
  readonly filename: string;
  /** The attachment version of the diagram, or an empty string. */
  readonly revision: string;
}

/** The users and the diagrams that a page refers to. The renderer needs their data. */
export interface StorageRefs {
  readonly accountIds: ReadonlyArray<string>;
  readonly diagrams: ReadonlyArray<Diagram>;
}

/** The data that {@link storageToMarkdown} needs from other requests. */
export interface Lookups {
  /** Display names by account ID. */
  readonly users: ReadonlyMap<string, string>;
  /** Diagram sources by file name. Null means that no source was found. */
  readonly diagrams: ReadonlyMap<string, string | null>;
}

interface Context {
  readonly lookups: Lookups;
  readonly inPre: boolean;
}

type Render = (element: Element, context: Context) => string;

const parse = (xhtml: string) =>
  parseDocument(xhtml, { recognizeCDATA: true, recognizeSelfClosing: true }).children;

const attr = (element: Element, name: string) => element.attribs[name] ?? "";

const tags = (nodes: ReadonlyArray<ChildNode>) => nodes.filter(isTag);

const child = (element: Element, name: string) =>
  tags(element.children).find((node) => node.name === name);

const textOf = (node: ChildNode | undefined) =>
  node === undefined ? "" : DomUtils.textContent(node);

const params = (macro: Element) =>
  new Map(
    tags(macro.children)
      .filter((node) => node.name === "ac:parameter")
      .map((node) => [attr(node, "ac:name"), textOf(node)] as const),
  );

const findAll = (nodes: Array<ChildNode>, name: string) =>
  DomUtils.findAll((node) => node.name === name, nodes);

/** Gives the text of an HTML fragment, with the entities decoded and the tags removed. */
export const htmlText = (html: string) => DomUtils.textContent(parse(html));

/** Finds the users and the "mermaid-cloud" diagrams that a page in storage format refers to. */
export const storageRefs = (xhtml: string): StorageRefs => {
  const nodes = parse(xhtml);
  const accountIds = findAll(nodes, "ri:user")
    .map((user) => attr(user, "ri:account-id"))
    .filter((id) => id !== "");
  const diagrams = findAll(nodes, "ac:structured-macro")
    .filter((macro) => attr(macro, "ac:name") === "mermaid-cloud")
    .map((macro) => {
      const values = params(macro);
      return { filename: values.get("filename") ?? "", revision: values.get("revision") ?? "" };
    });
  return { accountIds: [...new Set(accountIds)], diagrams };
};

const renderNodes = (nodes: ReadonlyArray<ChildNode>, context: Context): string =>
  nodes.map((node) => renderNode(node, context)).join("");

const children: Render = (element, context) => renderNodes(element.children, context);

const renderText = (data: string, context: Context) =>
  context.inPre ? data : data.replace(/\s+/g, " ");

const renderNode = (node: ChildNode, context: Context): string => {
  if (isText(node)) return renderText(node.data, context);
  if (isCDATA(node)) return renderNodes(node.children, context);
  return isTag(node) ? renderElement(node, context) : "";
};

const block = (text: string) => `\n\n${text.trim()}\n\n`;

const blockOf: Render = (element, context) => block(children(element, context));

const fence = (language: string, source: string) =>
  block(`\`\`\`${language}\n${source.replace(/\n+$/, "")}\n\`\`\``);

const wrap =
  (mark: string): Render =>
  (element, context) => {
    const text = children(element, context);
    return text.trim() === ""
      ? text
      : text.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${mark}$2${mark}$3`);
  };

const heading =
  (level: number): Render =>
  (element, context) =>
    block(`${"#".repeat(level)} ${children(element, context).trim()}`);

const indent = (text: string, first: string, rest = " ".repeat(first.length)) =>
  text
    .split("\n")
    .map((line, index) => (index === 0 ? first : rest) + line)
    .join("\n");

const listItem = (text: string, marker: string) =>
  indent(text.trim().replace(/\n{2,}/g, "\n"), marker);

const list =
  (marker: (index: number) => string, itemName = "li", item: Render = children): Render =>
  (element, context) =>
    block(
      tags(element.children)
        .filter((node) => node.name === itemName)
        .map((node, index) => listItem(item(node, context), marker(index)))
        .join("\n"),
    );

const task: Render = (element, context) => {
  const done = textOf(child(element, "ac:task-status")).trim() === "complete";
  const body = child(element, "ac:task-body");
  return `[${done ? "x" : " "}] ${body === undefined ? "" : children(body, context)}`;
};

const quote = (text: string) =>
  block(
    text
      .trim()
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => (line === "" ? ">" : `> ${line}`))
      .join("\n"),
  );

const TABLE_SECTIONS = new Set(["thead", "tbody", "tfoot"]);

const rowsOf = (table: Element): ReadonlyArray<Element> =>
  tags(table.children).flatMap((node) =>
    TABLE_SECTIONS.has(node.name) ? rowsOf(node) : node.name === "tr" ? [node] : [],
  );

const cellText = (cell: Element, context: Context) => {
  const text = children(cell, context)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("<br>")
    .replaceAll("|", "\\|");
  const span = Math.max(Number(attr(cell, "colspan")) || 1, 1);
  return [text, ...Array.from({ length: span - 1 }, () => "")];
};

const tableRow = (cells: ReadonlyArray<string>, width: number) =>
  `| ${[...cells, ...Array.from({ length: width - cells.length }, () => "")].join(" | ")} |`;

const table: Render = (element, context) => {
  const rows = rowsOf(element).map((row) =>
    tags(row.children)
      .filter((cell) => cell.name === "td" || cell.name === "th")
      .flatMap((cell) => cellText(cell, context)),
  );
  const width = Math.max(1, ...rows.map((cells) => cells.length));
  const [header = [], ...body] = rows;
  const divider = `|${" --- |".repeat(width)}`;
  return block(
    [tableRow(header, width), divider, ...body.map((r) => tableRow(r, width))].join("\n"),
  );
};

const mention = (user: Element, context: Context) =>
  `@${context.lookups.users.get(attr(user, "ri:account-id")) ?? "unknown user"}`;

const PANELS = new Set(["info", "note", "tip", "warning", "panel", "success", "error"]);

const DROPPED_MACROS = new Set(["toc", "anchor", "children", "pagetree", "recently-updated"]);

interface Macro {
  readonly name: string;
  readonly params: ReadonlyMap<string, string>;
  readonly rich: Element | undefined;
  readonly plain: Element | undefined;
}

const richText = (macro: Macro, context: Context) =>
  macro.rich === undefined ? "" : children(macro.rich, context);

const titled = (title: string, body: string) => `**${title}**\n\n${body.trim()}`;

const panel = (macro: Macro, context: Context) => {
  const title = macro.params.get("title");
  const label = macro.name.charAt(0).toUpperCase() + macro.name.slice(1);
  return quote(titled(title ? `${label}: ${title}` : label, richText(macro, context)));
};

const mermaid = (macro: Macro, context: Context) => {
  const filename = macro.params.get("filename") ?? "";
  const source = context.lookups.diagrams.get(filename);
  return source
    ? fence("mermaid", source)
    : block(`[Mermaid diagram '${filename}': no source found]`);
};

const MACROS: Readonly<Record<string, (macro: Macro, context: Context) => string>> = {
  "mermaid-cloud": mermaid,
  expand: (macro, context) =>
    block(titled(macro.params.get("title") || "Details", richText(macro, context))),
  status: (macro) => `[${macro.params.get("title") ?? ""}]`,
  jira: (macro) => macro.params.get("key") ?? "[JIRA issues]",
};

const plainText = (macro: Macro) => {
  const language = macro.name.includes("mermaid") ? "mermaid" : macro.params.get("language");
  return fence(language ?? "", textOf(macro.plain));
};

const bodyMacro = (macro: Macro, context: Context) =>
  macro.rich === undefined ? `[${macro.name} macro]` : block(richText(macro, context));

const otherMacro = (macro: Macro, context: Context) => {
  if (macro.plain !== undefined) return plainText(macro);
  if (PANELS.has(macro.name)) return panel(macro, context);
  return DROPPED_MACROS.has(macro.name) ? "" : bodyMacro(macro, context);
};

const macro: Render = (element, context) => {
  const value: Macro = {
    name: attr(element, "ac:name"),
    params: params(element),
    rich: child(element, "ac:rich-text-body"),
    plain: child(element, "ac:plain-text-body"),
  };
  return (MACROS[value.name] ?? otherMacro)(value, context);
};

const LINK_TARGETS: Readonly<
  Record<string, (target: Element, label: string, context: Context) => string>
> = {
  "ri:page": (target, label) => {
    const title = attr(target, "ri:content-title");
    return label !== "" && label !== title ? `${label} [[${title}]]` : `[[${title}]]`;
  },
  "ri:user": (target, _label, context) => mention(target, context),
  "ri:attachment": (target) => `[[attachment: ${attr(target, "ri:filename")}]]`,
  "ri:url": (target, label) =>
    `[${label || attr(target, "ri:value")}](${attr(target, "ri:value")})`,
};

const linkLabel = (element: Element, context: Context) => {
  const body = child(element, "ac:link-body");
  return (
    body === undefined ? textOf(child(element, "ac:plain-text-link-body")) : children(body, context)
  ).trim();
};

const link: Render = (element, context) => {
  const label = linkLabel(element, context);
  const target = tags(element.children).find((node) => node.name in LINK_TARGETS);
  return target === undefined
    ? label
    : (LINK_TARGETS[target.name]?.(target, label, context) ?? label);
};

const image: Render = (element) => {
  const source = tags(element.children).find(
    (n) => n.name === "ri:attachment" || n.name === "ri:url",
  );
  const src = source === undefined ? "" : attr(source, "ri:filename") || attr(source, "ri:value");
  return `![${attr(element, "ac:alt") || src}](${src})`;
};

const nothing: Render = () => "";

const TAGS: Readonly<Record<string, Render>> = {
  p: blockOf,
  div: blockOf,
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  br: () => "\n",
  hr: () => block("---"),
  strong: wrap("**"),
  b: wrap("**"),
  em: wrap("_"),
  i: wrap("_"),
  s: wrap("~~"),
  del: wrap("~~"),
  code: (element, context) =>
    context.inPre ? children(element, context) : `\`${textOf(element)}\``,
  pre: (element, context) =>
    fence(attr(element, "data-lang"), children(element, { ...context, inPre: true })),
  a: (element, context) => `[${children(element, context).trim()}](${attr(element, "href")})`,
  img: (element) => `![${attr(element, "alt")}](${attr(element, "src")})`,
  ul: list(() => "- "),
  ol: list((index) => `${index + 1}. `),
  blockquote: (element, context) => quote(children(element, context)),
  table,
  time: (element, context) => attr(element, "datetime") || children(element, context),
  "ac:layout-section": blockOf,
  "ac:layout-cell": blockOf,
  "ac:structured-macro": macro,
  "ac:adf-extension": (element, context) => {
    const fallback = child(element, "ac:adf-fallback");
    return fallback === undefined ? "" : blockOf(fallback, context);
  },
  "ac:link": link,
  "ri:user": mention,
  "ac:image": image,
  "ac:emoticon": (element) => attr(element, "ac:emoji-fallback"),
  "ac:task-list": list(() => "- ", "ac:task", task),
  "ac:parameter": nothing,
  "ac:placeholder": nothing,
};

const renderElement = (element: Element, context: Context): string =>
  (TAGS[element.name] ?? children)(element, context);

/**
 * Changes a Confluence page body in storage format (XHTML) to Markdown:
 *
 * - Tables stay Markdown tables. A cell with more than one line uses `<br>` between the lines.
 * - Mermaid diagrams become `mermaid` code blocks. The "mermaid-cloud" sources come from `lookups`.
 * - Links to other pages become `[[Page Title]]`. Mentions become `@Display Name`.
 * - Status labels become `[Label]`. Panels become block quotes. Tasks become `[ ]` and `[x]` items.
 * - Other macros without text become `[<name> macro]`.
 */
export const storageToMarkdown = (xhtml: string, lookups: Lookups) =>
  renderNodes(parse(xhtml), { lookups, inPre: false })
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
