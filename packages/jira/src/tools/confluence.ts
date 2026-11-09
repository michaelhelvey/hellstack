import { Type } from "typebox";
import { listChildren, readPage, searchContent } from "../confluence/pages.ts";
import { jiraTool, Nullable } from "./define.ts";

const ContentResults = Type.Object({
  results: Type.Array(
    Type.Object({
      id: Type.String(),
      type: Type.String({
        description:
          "page, folder, database, attachment, comment, and others. Only a page has a body.",
      }),
      title: Type.String(),
      space: Nullable(Type.String()),
      url: Nullable(Type.String()),
      excerpt: Type.String(),
      lastModified: Nullable(Type.String()),
    }),
  ),
  totalSize: Type.Integer({ description: "All matches. It can be more than the results." }),
});

const Limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 250 }));

const search = jiraTool({
  name: "confluence_search",
  label: "Confluence: search",
  description:
    'Search Confluence with CQL, for example text ~ "words" and type = page. Useful clauses: title ~ "...", space = "KEY", parent = <id>, lastModified >= "2026-01-01".',
  readOnly: true,
  parameters: Type.Object({
    cql: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 250, description: "Default: 25" })),
  }),
  output: ContentResults,
  run: (params) => searchContent(params.cql, params.limit),
});

const children = jiraTool({
  name: "confluence_children",
  label: "Confluence: children",
  description: "List the children of a Confluence page or folder.",
  readOnly: true,
  parameters: Type.Object({
    id: Type.String({ description: "The page or folder ID" }),
    limit: Limit,
  }),
  output: ContentResults,
  run: (params) => listChildren(params.id, params.limit),
});

const page = jiraTool({
  name: "confluence_page",
  label: "Confluence: read page",
  description:
    "Read a Confluence page as Markdown. Tables stay tables, Mermaid diagrams become mermaid code blocks, links to pages become [[Page Title]], and mentions become @Name. Pages are long: filter the markdown in the script, or write it to a file, before you show it.",
  readOnly: true,
  parameters: Type.Object({
    page: Type.String({ description: "A page ID or a page URL" }),
  }),
  output: Type.Object({
    id: Type.String(),
    title: Type.String(),
    url: Type.String(),
    markdown: Type.String(),
  }),
  run: (params) => readPage(params.page),
});

/** The Confluence tools. */
export const CONFLUENCE_TOOLS = [search, children, page];
