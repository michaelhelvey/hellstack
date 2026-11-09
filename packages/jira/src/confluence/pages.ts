import { Effect, Schema } from "effect";
import { Atlassian, AtlassianError, get } from "../atlassian.ts";
import { nullable } from "../jira/schemas.ts";
import { htmlText, storageRefs, storageToMarkdown, type Diagram } from "./storage.ts";

const fail = (message: string) => Effect.fail(new AtlassianError({ message }));

const site = Atlassian.use((atlassian) => atlassian.site);

const optionalString = Schema.optional(Schema.String);

const text = Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("")));

const SearchResults = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      title: text,
      excerpt: text,
      url: nullable(Schema.String),
      lastModified: nullable(Schema.String),
      content: Schema.optional(
        Schema.Struct({ id: Schema.String, type: Schema.String, title: text }),
      ),
      resultGlobalContainer: nullable(Schema.Struct({ title: Schema.String })),
    }),
  ),
  totalSize: Schema.optional(Schema.Int),
});

type SearchResult = (typeof SearchResults.Type)["results"][number];

/** A Confluence search result. */
export interface ContentResult {
  readonly id: string;
  /**
   * `page`, `folder`, `database`, `attachment`, `comment`, and others. Only a `page` has a body
   * that {@link readPage} can read.
   */
  readonly type: string;
  readonly title: string;
  /** The title of the space. */
  readonly space: string | null;
  readonly url: string | null;
  readonly excerpt: string;
  readonly lastModified: string | null;
}

/** The result of {@link searchContent}. */
export interface ContentResults {
  readonly results: ReadonlyArray<ContentResult>;
  /** The number of results that match the CQL. It can be more than the results here. */
  readonly totalSize: number;
}

const resultUrl = (site: string, result: SearchResult) =>
  result.url === null ? null : `${site}/wiki${result.url}`;

const titleOrNull = (container: { readonly title: string } | null) =>
  container === null ? null : container.title;

const toResult =
  (site: string) =>
  (result: SearchResult): ReadonlyArray<ContentResult> =>
    result.content === undefined
      ? []
      : [
          {
            id: result.content.id,
            type: result.content.type,
            title: result.title || result.content.title,
            space: titleOrNull(result.resultGlobalContainer),
            url: resultUrl(site, result),
            excerpt: htmlText(result.excerpt.replace(/@@@(?:end)?hl@@@/g, "")).trim(),
            lastModified: result.lastModified,
          },
        ];

/**
 * Searches Confluence with CQL, for example `text ~ "words" and type = page`. Results that are not
 * content (for example spaces and users) are not included.
 */
export const searchContent = Effect.fnUntraced(function* (cql: string, limit = 25) {
  const found = yield* get(SearchResults, "/wiki/rest/api/search", { cql, limit });
  const url = yield* site;
  const results: ContentResults = {
    results: found.results.flatMap(toResult(url)),
    totalSize: found.totalSize ?? found.results.length,
  };
  return results;
});

/**
 * Lists the children of a page or a folder. It uses CQL `parent = <id>`, because the v2
 * `parent-id` parameter does not filter.
 */
export const listChildren = (id: string, limit = 100) =>
  searchContent(`parent = ${Number(id)}`, limit);

const PAGE_ID: ReadonlyArray<RegExp> = [/^(\d+)$/, /\/pages\/(\d+)/, /[?&]pageId=(\d+)/];

/** Gets the page ID from a page ID or a page URL. */
export const pageId = (input: string) => {
  const id = PAGE_ID.map((pattern) => pattern.exec(input.trim())?.[1]).find(Boolean);
  return id === undefined ? fail(`no page ID in "${input}"`) : Effect.succeed(id);
};

const links = <S extends Schema.Top>(schema: S) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed({})));

const Page = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.Struct({ storage: Schema.Struct({ value: Schema.String }) }),
  links: links(Schema.Struct({ webui: optionalString })),
}).pipe(Schema.encodeKeys({ links: "_links" }));

const Attachments = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      mediaType: Schema.String,
      version: Schema.Struct({ number: Schema.Int }),
    }),
  ),
  links: links(Schema.Struct({ next: optionalString })),
}).pipe(Schema.encodeKeys({ links: "_links" }));

/** A page attachment. */
export type Attachment = (typeof Attachments.Type)["results"][number];

const attachmentPages = (
  path: string,
): Effect.Effect<ReadonlyArray<Attachment>, AtlassianError, Atlassian> =>
  Effect.flatMap(get(Attachments, path), (page) => {
    const next = page.links.next;
    return next === undefined
      ? Effect.succeed(page.results)
      : Effect.map(attachmentPages(next), (more) => [...page.results, ...more]);
  });

const normalize = (title: string) => title.split(/\s+/).join(" ").toLowerCase();

/**
 * Finds the attachment that has the source of a diagram. It tries an exact title, then a title
 * with other case and spaces, then the only title that starts with the file name. Images are not
 * sources.
 */
export const findDiagram = (attachments: ReadonlyArray<Attachment>, filename: string) => {
  const sources = attachments.filter((a) => !a.mediaType.startsWith("image/"));
  const key = normalize(filename);
  const tries: ReadonlyArray<(a: Attachment) => boolean> = [
    (a) => a.title === filename,
    (a) => normalize(a.title) === key,
    (a) => normalize(a.title).startsWith(key),
  ];
  for (const test of tries) {
    const found = sources.filter(test);
    if (found.length === 1) return found[0];
  }
  return undefined;
};

const diagramVersion = (attachment: Attachment, revision: string) => {
  const latest = attachment.version.number;
  const wanted = Number(revision);
  return Number.isInteger(wanted) && wanted > 0 && wanted < latest ? wanted : latest;
};

const download = (page: string, attachment: Attachment, revision: string) =>
  Atlassian.use((atlassian) =>
    atlassian.text({
      path: `/wiki/rest/api/content/${page}/child/attachment/${attachment.id}/download`,
      query: { version: diagramVersion(attachment, revision) },
    }),
  );

const diagramSources = Effect.fnUntraced(function* (
  page: string,
  diagrams: ReadonlyArray<Diagram>,
) {
  if (diagrams.length === 0) return new Map<string, string | null>();
  const attachments = yield* attachmentPages(`/wiki/api/v2/pages/${page}/attachments?limit=250`);
  const sources = yield* Effect.forEach(diagrams, (diagram) => {
    const attachment = findDiagram(attachments, diagram.filename);
    return Effect.map(
      attachment === undefined
        ? Effect.succeed(null)
        : download(page, attachment, diagram.revision),
      (source) => [diagram.filename, source] as const,
    );
  });
  return new Map(sources);
});

const Users = Schema.Struct({
  results: Schema.Array(Schema.Struct({ accountId: Schema.String, displayName: Schema.String })),
});

const userNames = (accountIds: ReadonlyArray<string>) =>
  accountIds.length === 0
    ? Effect.succeed(new Map<string, string>())
    : Effect.map(
        get(Users, "/wiki/rest/api/user/bulk", { accountId: accountIds }),
        (users) => new Map(users.results.map((user) => [user.accountId, user.displayName])),
      );

/** A Confluence page as Markdown. */
export interface PageMarkdown {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** The page as Markdown, with the title as the first heading. */
  readonly markdown: string;
}

/**
 * Reads a Confluence page and changes it to Markdown. The input is a page ID or a page URL. See
 * {@link storageToMarkdown} for how the page changes.
 */
export const readPage = Effect.fnUntraced(function* (input: string) {
  const id = yield* pageId(input);
  const page = yield* get(Page, `/wiki/api/v2/pages/${id}`, { "body-format": "storage" });
  const body = page.body.storage.value;
  const refs = storageRefs(body);
  const [users, diagrams, url] = yield* Effect.all(
    [userNames(refs.accountIds), diagramSources(page.id, refs.diagrams), site],
    { concurrency: "unbounded" },
  );
  const result: PageMarkdown = {
    id: page.id,
    title: page.title,
    url: `${url}/wiki${page.links.webui ?? `/pages/viewpage.action?pageId=${page.id}`}`,
    markdown: `# ${page.title}\n\n${storageToMarkdown(body, { users, diagrams })}\n`,
  };
  return result;
});
