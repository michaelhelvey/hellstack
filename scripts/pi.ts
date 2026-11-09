import path from "node:path";
import { localServers, pi } from "../packages/agent/src/harness.ts";
import { build } from "../packages/pi/src/build.ts";

/** The agent folder of the sandbox pi. Pi keeps its settings, packages, and sessions here. */
export const AGENT_DIR = path.join(import.meta.dir, "..", ".pi", "sandbox");

/** The settings of the sandbox pi. The script writes them on each start. */
export const SETTINGS = {
  packages: ["npm:pi-claude-bridge", path.join(import.meta.dir, "..", "packages", "pi")],
  defaultProvider: "claude-bridge",
  defaultModel: "claude-opus-5-5",
  defaultProjectTrust: "always",
  quietStartup: true,
};

/** The settings of `pi-claude-bridge`. */
export const CLAUDE_BRIDGE_SETTINGS = { provider: { plan: "max" } };

const writeJson = (file: string, value: unknown) =>
  Bun.write(path.join(AGENT_DIR, file), `${JSON.stringify(value, null, 2)}\n`);

await build();
await writeJson("settings.json", SETTINGS);
await writeJson("claude-bridge.json", CLAUDE_BRIDGE_SETTINGS);
await writeJson("mcp.json", pi(AGENT_DIR, localServers(process.execPath)).configs["mcp.json"]);

const sandbox = Bun.spawn(["pi", ...Bun.argv.slice(2)], {
  env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR },
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await sandbox.exited);
