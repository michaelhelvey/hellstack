import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerEditorFeature } from "../shared/editor/register.ts";
import { QuotePicker } from "./feature.ts";
import { lastReplies, paragraphs, type Quote } from "./quotes.ts";

function quoteSource(session: ExtensionContext["sessionManager"]): () => readonly Quote[] {
  let leaf: string | null | undefined;
  let quotes: Quote[] = [];

  return () => {
    const current = session.getLeafId();
    if (current === leaf) return quotes;
    leaf = current;
    quotes = lastReplies(session.getBranch()).flatMap(paragraphs);
    return quotes;
  };
}

/**
 * Lets the user quote blocks of the last assistant replies. Type `>` at the start of a line to
 * open the picker, then type words to filter it.
 */
export default function quickQuote(pi: ExtensionAPI): void {
  registerEditorFeature(pi, "quick-quote", (ctx, editor) => {
    const options = { quotes: quoteSource(ctx.sessionManager), theme: () => ctx.ui.theme };
    return new QuotePicker(editor, options);
  });
}
