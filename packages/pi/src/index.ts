import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import askUserQuestion from "./ask-user-question.ts";
import bashPermissions from "./bash-permissions.ts";
import { collectHeader, renderHeader } from "./header.ts";
import quickQuote from "./quick-quote.ts";
import webFetch from "./web-fetch.ts";

/**
 * The hellstack pi extension. It replaces the startup header with the token cost of the context
 * files, skills, and extensions of the session. It also adds the `ask_user_question` and
 * `web_fetch` tools, blocks some bash commands, and adds the `>` quote picker to the editor.
 */
export default function hellstack(pi: ExtensionAPI) {
  askUserQuestion(pi);
  webFetch(pi);
  bashPermissions(pi);
  quickQuote(pi);
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const header = collectHeader(pi, ctx);
    ctx.ui.setHeader((_tui, theme) => ({
      render: (width) => renderHeader(header, theme, width),
      invalidate: () => {},
    }));
  });
}
