import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "../src/build.ts";
import { FAKE_MODEL, FAKE_PROVIDER, FakeModel } from "./fake-model.ts";
import { RpcPi } from "./rpc.ts";
import { TuiPi } from "./tui.ts";

const PACKAGE_DIR = path.resolve(import.meta.dir, "..");

/** Pi loads the bundle, so each test run bundles the current source one time. */
let built: Promise<void> | undefined;

/**
 * A temporary home folder for pi that loads this package, with a fake model. Pi does not read the
 * files of the real user.
 */
export class PiSandbox {
  /** The model that pi uses. Tests script its replies. */
  readonly model = new FakeModel();
  readonly #running: Array<RpcPi | TuiPi> = [];

  private constructor(readonly root: string) {}

  /** Makes a sandbox with the pi settings, and the hellstack package in its `packages`. */
  static async create(settings: Record<string, unknown> = {}): Promise<PiSandbox> {
    built ??= build();
    await built;
    const sandbox = new PiSandbox(await mkdtemp(path.join(os.tmpdir(), "hellstack-pi-")));
    await sandbox.write("work/.keep", "");
    await sandbox.write(
      ".pi/agent/settings.json",
      JSON.stringify({ packages: [PACKAGE_DIR], quietStartup: true, ...settings }),
    );
    await sandbox.write(
      ".pi/agent/models.json",
      JSON.stringify({ providers: { [FAKE_PROVIDER]: sandbox.model.provider } }),
    );
    return sandbox;
  }

  /** The pi agent folder. */
  get agentDir(): string {
    return path.join(this.root, ".pi", "agent");
  }

  /** The working folder of pi. */
  get workDir(): string {
    return path.join(this.root, "work");
  }

  /** Writes a file relative to the sandbox root. */
  async write(file: string, content: string): Promise<void> {
    const target = path.join(this.root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  /**
   * Starts pi in interactive mode in a pseudo-terminal, waits until the screen contains `text`,
   * stops pi, and returns the screen.
   */
  async screenWhen(text: string): Promise<string> {
    const pi = this.tui();
    try {
      return await pi.waitFor(text);
    } finally {
      await pi.stop();
    }
  }

  /** Starts pi in interactive mode in a pseudo-terminal, with the fake model. */
  tui(): TuiPi {
    const pi = new TuiPi(this.#command(), this.workDir, this.#env(), FAKE_MODEL);
    this.#running.push(pi);
    return pi;
  }

  /** Starts pi in RPC mode with the fake model. `env` adds environment variables. */
  rpc(env: Record<string, string> = {}): RpcPi {
    const pi = new RpcPi(this.#command(), this.workDir, { ...this.#env(), ...env });
    this.#running.push(pi);
    return pi;
  }

  /** Stops pi and the fake model, and removes the sandbox. */
  async dispose(): Promise<void> {
    await Promise.all(this.#running.map((pi) => pi.stop()));
    await this.model.stop();
    await rm(this.root, { recursive: true, force: true });
  }

  #command(): Array<string> {
    return ["pi", "--no-session", "--provider", FAKE_PROVIDER, "--model", FAKE_MODEL];
  }

  #env(): Record<string, string> {
    return {
      PATH: process.env.PATH ?? "",
      HOME: this.root,
      PI_CODING_AGENT_DIR: this.agentDir,
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
    };
  }
}
