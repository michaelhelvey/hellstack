import { Schema } from "effect";
import { Toolkit } from "effect/ai";
import { listChildren, readPage, searchContent } from "../confluence/pages.ts";
import { jiraTool, READS } from "./define.ts";

const NullableString = Schema.NullOr(Schema.String);

const ContentResults = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      type: Schema.String.annotate({
        description:
          "page, folder, database, attachment, comment, and others. Only a page has a body.",
      }),
      title: Schema.String,
      space: NullableString,
      url: NullableString,
      excerpt: Schema.String,
      lastModified: NullableString,
    }),
  ),
  totalSize: Schema.Int.annotate({
    description: "All matches. It can be more than the results.",
  }),
});

const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 250 }));

const Search = jiraTool("confluence_search", {
  description:
    'Search Confluence with CQL, for example text ~ "words" and type = page. Useful clauses: title ~ "...", space = "KEY", parent = <id>, lastModified >= "2026-01-01".',
  hints: READS,
  parameters: Schema.Struct({
    cql: Schema.String,
    limit: Schema.optionalKey(Limit.annotate({ description: "Default: 25" })),
  }),
  success: ContentResults,
});

const Children = jiraTool("confluence_children", {
  description: "List the children of a Confluence page or folder.",
  hints: READS,
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "The page or folder ID" }),
    limit: Schema.optionalKey(Limit),
  }),
  success: ContentResults,
});

const Page = jiraTool("confluence_page", {
  description:
    "Read a Confluence page as Markdown. Tables stay tables, Mermaid diagrams become mermaid code blocks, links to pages become [[Page Title]], and mentions become @Name. Pages are long: filter the markdown in the script, or write it to a file, before you show it.",
  hints: READS,
  parameters: Schema.Struct({
    page: Schema.String.annotate({ description: "A page ID or a page URL" }),
  }),
  success: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    url: Schema.String,
    markdown: Schema.String,
  }),
});

/** The Confluence tools. */
export const ConfluenceTools = Toolkit.make(Search, Children, Page);

/** The handlers of {@link ConfluenceTools}. */
export const ConfluenceHandlers = ConfluenceTools.toLayer({
  confluence_search: (params) => searchContent(params.cql, params.limit),
  confluence_children: (params) => listChildren(params.id, params.limit),
  confluence_page: (params) => readPage(params.page),
});
