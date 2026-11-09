import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import herdr from "@michaelhelvey/hellstack-herdr";
import jira from "@michaelhelvey/hellstack-jira";
import askUserQuestion from "./ask-user-question.ts";
import bashPermissions from "./bash-permissions.ts";
import { collectHeader, renderHeader } from "./header.ts";
import quickQuote from "./quick-quote.ts";
import webFetch from "./web-fetch.ts";

/**
 * The hellstack pi extension. It replaces the startup header with the token cost of the context
 * files, skills, and extensions of the session. It also adds the `ask_user_question` and
 * `web_fetch` tools, blocks some bash commands, and adds the `>` quote picker to the editor. The
 * Jira and Confluence tools are in the `jira` namespace, for codemode scripts only. The `agent_*`
 * and `report` tools start and control pi subagents in herdr-core terminals.
 */
export default function hellstack(pi: ExtensionAPI) {
  askUserQuestion(pi);
  webFetch(pi);
  jira(pi);
  herdr(pi);
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
