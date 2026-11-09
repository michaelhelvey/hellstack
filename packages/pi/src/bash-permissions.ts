import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Bash commands that the agent must not run. The user runs them. */
export const BLOCKED_COMMANDS: ReadonlyArray<RegExp> = [/\baws\s+sso\s+login\b/];

/**
 * Blocks bash commands that match a pattern in `BLOCKED_COMMANDS`. This includes calls that other
 * tools, such as `codemode`, make.
 */
export default function bashPermissions(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return undefined;
    const pattern = BLOCKED_COMMANDS.find((p) => p.test(event.input.command));
    if (pattern === undefined) return undefined;
    return {
      block: true,
      reason: `The command matches the blocked pattern ${pattern}. Do not run it. Ask the user to run it.`,
    };
  });
}
