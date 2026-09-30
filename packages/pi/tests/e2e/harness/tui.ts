import type { PiCommand } from "./rpc.ts";

const TIMEOUT_MS = 20_000;
const STARTUP_BUSY = "Startup is still in progress";

/**
 * Runs pi in interactive mode in a pseudo-terminal. Tests type keys and read the text that pi
 * shows. Use it only for behavior that RPC mode does not show, such as working messages.
 */
export class TuiPi {
  #output = "";
  readonly #proc: Bun.Subprocess;
  readonly #terminal: Bun.Terminal;

  constructor(command: PiCommand) {
    const decoder = new TextDecoder();
    this.#proc = Bun.spawn(command.cmd, {
      cwd: command.cwd,
      env: { ...command.env, TERM: "xterm-256color" },
      terminal: {
        cols: 120,
        rows: 40,
        data: (_terminal, bytes) => {
          this.#output += decoder.decode(bytes, { stream: true });
        },
      },
    });
    if (!this.#proc.terminal) throw new Error("Bun did not make a terminal for pi");
    this.#terminal = this.#proc.terminal;
  }

  /** All text that pi wrote to the terminal, without ANSI escape sequences. */
  get output(): string {
    return Bun.stripANSI(this.#output);
  }

  /** Writes keys to the terminal. Use `\r` for Enter and `\x1b` for Escape. */
  type(keys: string): void {
    this.#terminal.write(keys);
  }

  /**
   * Types the text and presses Enter. Pi shows the editor before startup is complete, and keeps
   * the text in the editor if it gets Enter too early. In that case, this method presses Enter again.
   */
  async submit(text: string): Promise<void> {
    this.type(text);
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const mark = this.#output.length;
      this.type("\r");
      await Bun.sleep(300);
      if (!Bun.stripANSI(this.#output.slice(mark)).includes(STARTUP_BUSY)) return;
    }
    throw new Error(`Pi did not complete startup. Output:\n${this.output}`);
  }

  /** Waits until the output contains the text, or matches the pattern. Returns the output. */
  async waitFor(expected: string | RegExp): Promise<string> {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.#matches(expected)) return this.output;
      await Bun.sleep(50);
    }
    throw new Error(`Timed out waiting for ${String(expected)}. Output:\n${this.output}`);
  }

  /** Stops pi. */
  async stop(): Promise<void> {
    this.#proc.kill();
    await this.#proc.exited;
    this.#terminal.close();
  }

  #matches(expected: string | RegExp): boolean {
    const output = this.output;
    return typeof expected === "string" ? output.includes(expected) : expected.test(output);
  }
}
