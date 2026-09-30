import type { Plugin } from "@opencode-ai/plugin/tui";

import { herdrEnabled, herdrRequest } from "./client.ts";

const pollMs = 250;

function shownRootSession(context: Plugin.Context): string | undefined {
  const route = context.ui.router.current();
  if (route.type !== "session") return undefined;
  const session = context.data.session.get(route.sessionID);
  return session?.parentID ? undefined : session?.id;
}

/**
 * Tells herdr which root session the opencode TUI shows in the pane, so that herdr can connect the
 * pane to the session.
 */
export default {
  id: "local.herdr-session",
  setup: (context) => {
    if (!herdrEnabled()) return;
    let reported: string | undefined;
    function poll(): void {
      const sessionID = shownRootSession(context);
      if (sessionID === undefined || sessionID === reported) return;
      reported = sessionID;
      const params = { agent_session_id: sessionID, session_start_source: "select" };
      void herdrRequest("pane.report_agent_session", params);
    }
    poll();
    const timer = setInterval(poll, pollMs);
    return () => clearInterval(timer);
  },
} satisfies Plugin.Definition;
