import {
  blockquote,
  type Draft,
  filterParagraphs,
  label,
  latestParagraphs,
  type Message,
  quoteQuery,
} from "./quotes.ts";

/** One row that a `prompt.autocomplete` hook adds to the typeahead. */
export interface Suggestion {
  text: string;
  label?: string;
}

/** The result of a `prompt.autocomplete` event. */
export interface AutocompleteResult {
  suggestions: readonly Suggestion[];
}

/** The part of the Claude Code `$` that this mod uses. */
export interface Engine {
  session: { messages: () => Promise<readonly Message[]> };
}

/** The part of the Claude Code `on` function that this mod uses. */
export type On = (
  event: "prompt.autocomplete",
  matcher: { token: RegExp },
  hook: (
    $: Engine,
    e: Draft,
    next: (e: Draft) => Promise<AutocompleteResult>,
  ) => Promise<AutocompleteResult>,
) => void;

/**
 * Makes the typeahead row for a paragraph. Taking the row writes the blockquote and puts the cursor
 * on an empty line below it.
 */
function suggestion(paragraph: string): Suggestion {
  return { text: `${blockquote(paragraph)}\n\n`, label: label(paragraph) };
}

/**
 * Registers the hook that shows the paragraphs of the last reply in the typeahead when a prompt
 * line starts with `>`.
 */
export function register(on: On): void {
  on("prompt.autocomplete", { token: /^>/ }, async ($, e, next) => {
    const query = quoteQuery(e);
    const below = await next(e);
    if (query === undefined) return below;
    const found = filterParagraphs(latestParagraphs(await $.session.messages()), query);
    return { suggestions: [...found.map(suggestion), ...below.suggestions] };
  });
}
