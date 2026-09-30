import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FAKE_MODEL, FAKE_PROVIDER, FakeModel } from "./fake-model.ts";
import { readText } from "./lines.ts";
import { type PiCommand, RpcPi } from "./rpc.ts";
import { TuiPi } from "./tui.ts";

/** The pi binary under test. Set `PI_BIN` to test a different binary. */
export const PI_BIN = process.env.PI_BIN ?? "pi";

/** The folder of the `@hellstack/pi` package. */
export const PACKAGE_DIR = path.resolve(import.meta.dir, "../../..");

/** Options for a pi sandbox. */
export interface SandboxOptions {
  /** More extension files to load with `-e`, for example a probe extension. */
  extensions?: string[];
  /** More environment variables for pi. */
  env?: Record<string, string>;
}

/** The output and exit code of one pi run in print mode. */
export interface PrintResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const INHERITED_ENV_PREFIXES = ["PI_", "HERDR_"];
const INHERITED_ENV_NAMES = new Set(["WEB_FETCH_BIN", "LIGHTPANDA_BIN"]);

function isHostSetting(name: string): boolean {
  return INHERITED_ENV_NAMES.has(name) || INHERITED_ENV_PREFIXES.some((p) => name.startsWith(p));
}

function hostEnv(): Record<string, string> {
  const entries = Object.entries(process.env).filter(([name]) => !isHostSetting(name));
  return Object.fromEntries(entries.filter((e): e is [string, string] => e[1] !== undefined));
}

async function writeAgentDir(agentDir: string, model: FakeModel): Promise<void> {
  const provider = {
    baseUrl: model.baseUrl,
    api: "openai-completions",
    apiKey: "fake",
    models: [{ id: FAKE_MODEL }],
  };
  await Bun.write(
    path.join(agentDir, "models.json"),
    JSON.stringify({ providers: { [FAKE_PROVIDER]: provider } }),
  );
  await Bun.write(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ packages: [PACKAGE_DIR], quietStartup: true }),
  );
}

/**
 * A temporary pi setup: an agent folder that installs this package, a work folder, and a fake
 * model. Pi does not read the agent folder or the settings of the host.
 */
export class PiSandbox {
  readonly #stops: Array<() => Promise<unknown>> = [];

  private constructor(
    readonly model: FakeModel,
    readonly root: string,
    readonly options: SandboxOptions,
  ) {}

  /** Makes the temporary folders and starts the fake model. */
  static async create(options: SandboxOptions = {}): Promise<PiSandbox> {
    const root = await mkdtemp(path.join(tmpdir(), "hellstack-pi-e2e-"));
    const sandbox = new PiSandbox(new FakeModel(), root, options);
    await mkdir(sandbox.workDir);
    await writeAgentDir(sandbox.agentDir, sandbox.model);
    return sandbox;
  }

  /** The pi agent folder (`PI_CODING_AGENT_DIR`). */
  get agentDir(): string {
    return path.join(this.root, "agent");
  }

  /** The working folder of pi. */
  get workDir(): string {
    return path.join(this.root, "work");
  }

  /** The command, working folder, and environment to start pi with. */
  command(...args: string[]): PiCommand {
    const extensions = (this.options.extensions ?? []).flatMap((file) => ["-e", file]);
    const model = ["--provider", FAKE_PROVIDER, "--model", FAKE_MODEL];
    return {
      cmd: [PI_BIN, ...model, "--no-context-files", ...extensions, ...args],
      cwd: this.workDir,
      env: { ...hostEnv(), ...this.#piEnv(), ...this.options.env },
    };
  }

  /** Starts pi in RPC mode. */
  async startRpc(...args: string[]): Promise<RpcPi> {
    const pi = await RpcPi.start(this.command(...args));
    this.#stops.push(() => pi.stop());
    return pi;
  }

  /** Starts pi in interactive mode in a pseudo-terminal. */
  startTui(...args: string[]): TuiPi {
    const pi = new TuiPi(this.command(...args));
    this.#stops.push(() => pi.stop());
    return pi;
  }

  /** Runs pi in print mode (`-p`) with the message, and waits for it to exit. */
  async print(message: string): Promise<PrintResult> {
    const { cmd, cwd, env } = this.command("-p", message);
    const proc = Bun.spawn(cmd, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      readText(proc.stdout),
      readText(proc.stderr),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  /** Stops pi and the fake model, and removes the temporary folders. */
  async dispose(): Promise<void> {
    await Promise.all(this.#stops.map((stop) => stop()));
    await this.model.stop();
    await rm(this.root, { recursive: true, force: true });
  }

  #piEnv(): Record<string, string> {
    return { PI_CODING_AGENT_DIR: this.agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" };
  }
}
