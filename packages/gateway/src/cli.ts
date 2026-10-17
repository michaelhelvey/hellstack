import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { gatewayAuthPath, planGateway, setupCommand } from "./gateway.ts";

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

function runSetup(command: string[]): void {
  console.log(`running ${[...setupCommand, "<token>"].join(" ")}`);
  const result = Bun.spawnSync(command, { stdio: ["ignore", "inherit", "inherit"] });
  if (result.exitCode === 0) return;
  console.error("the Claude Code gateway setup failed");
  process.exit(result.exitCode ?? 1);
}

async function main(): Promise<void> {
  const home = homedir();
  const settingsPath = join(home, ".claude", "settings.json");
  const auth = await readText(join(home, gatewayAuthPath));
  const plan = planGateway(auth, await readText(settingsPath));
  if (plan.kind === "none") {
    console.log(`no ${gatewayAuthPath} in ${home}; the Claude Code gateway is not set up`);
    return;
  }
  if (plan.kind === "ready") {
    console.log(`the Claude Code gateway is already set up in ${settingsPath}`);
    return;
  }
  runSetup(plan.command);
}

if (import.meta.main) await main();
