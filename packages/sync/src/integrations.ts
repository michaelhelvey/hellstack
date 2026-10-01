/** A command that installs a tool integration into the harness directories after the sync. */
export interface Integration {
  /** The name to show in the output. */
  name: string;
  /** The command and its arguments. The sync skips the integration when the command is not on the PATH. */
  command: [string, ...string[]];
  /** The command to show in the output. Use it to hide secrets. The default is the command. */
  display?: string;
}

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
  log(`run     ${integration.display ?? integration.command.join(" ")}`);
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
