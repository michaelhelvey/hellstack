/** A command that installs a tool integration into the harness directories after the sync. */
export interface Integration {
  /** The name to show in the output. */
  name: string;
  /** The command and its arguments. The sync skips the integration when the command is not on the PATH. */
  command: [string, ...string[]];
}

/**
 * The integrations that the sync installs, in order. There is no herdr integration for opencode:
 * the herdr opencode plugin does not load in opencode v2, so `@hellstack/opencode` has its own
 * herdr plugin.
 */
export const integrations: Integration[] = [
  { name: "herdr (Claude Code)", command: ["herdr", "integration", "install", "claude"] },
  { name: "herdr (pi)", command: ["herdr", "integration", "install", "pi"] },
];

async function runIntegration(
  integration: Integration,
  log: (line: string) => void,
): Promise<boolean> {
  const [binary, ...args] = integration.command;
  const path = Bun.which(binary);
  if (path === null) {
    log(`skip    ${integration.name}: ${binary} is not on the PATH`);
    return true;
  }
  log(`run     ${integration.command.join(" ")}`);
  const child = Bun.spawn([path, ...args], { stdio: ["ignore", "inherit", "inherit"] });
  return (await child.exited) === 0;
}

/** Runs each integration, one at a time. Returns the names of the integrations that failed. */
export async function runIntegrations(
  list: Integration[],
  log: (line: string) => void,
): Promise<string[]> {
  const failed: string[] = [];
  for (const integration of list) {
    if (!(await runIntegration(integration, log))) failed.push(integration.name);
  }
  return failed;
}
