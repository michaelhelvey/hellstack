import { join } from "node:path";

/** The directories that the sync writes to. */
export interface Roots {
  /** The home directory. The sync shows target paths relative to it. */
  home: string;
  /** The Claude Code config directory, usually `~/.claude`. */
  claude: string;
  /** The shared agent directory, usually `~/.agents`. pi, opencode, Codex, and other tools read it. */
  agents: string;
  /** The opencode config directory, usually `~/.config/opencode`. */
  opencode: string;
  /** The pi agent directory, usually `~/.pi/agent`. */
  pi: string;
  /** The directory for the sync manifest and backups, usually `~/.local/state/hellstack`. */
  state: string;
  /** The directory for the local sync config of this machine, usually `~/.config/hellstack`. */
  config: string;
}

/** The environment variables that change the default directories. */
export type Env = Record<string, string | undefined>;

function envOr(env: Env, name: string, fallback: string): string {
  return env[name] || fallback;
}

/** Finds the directory of each harness. Each harness uses the same environment variables. */
export function resolveRoots(home: string, env: Env): Roots {
  const config = envOr(env, "XDG_CONFIG_HOME", join(home, ".config"));
  const state = envOr(env, "XDG_STATE_HOME", join(home, ".local", "state"));
  return {
    home,
    claude: envOr(env, "CLAUDE_CONFIG_DIR", join(home, ".claude")),
    agents: join(home, ".agents"),
    opencode: join(config, "opencode"),
    pi: envOr(env, "PI_CODING_AGENT_DIR", join(home, ".pi", "agent")),
    state: join(state, "hellstack"),
    config: join(config, "hellstack"),
  };
}
