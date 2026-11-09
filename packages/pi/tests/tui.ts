import { Terminal } from "@xterm/headless";

const COLS = 100;
const ROWS = 40;
const TIMEOUT_MS = 20_000;
const STARTUP_BUSY = "Startup is still in progress";

/**
 * Runs pi in interactive mode in a pseudo-terminal. Tests type keys and read the screen.
 */
export class TuiPi {
  readonly #terminal = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  readonly #proc: Bun.Subprocess;

  /**
   * `ready` is text that pi shows in the footer when it can take input, for example the name of
   * the model.
   */
  constructor(
    cmd: Array<string>,
    cwd: string,
    env: Record<string, string>,
    private readonly ready: string,
  ) {
    this.#proc = Bun.spawn(cmd, {
      cwd,
      env: { ...env, TERM: "xterm-256color" },
      terminal: { cols: COLS, rows: ROWS, data: (_pty, bytes) => this.#terminal.write(bytes) },
    });
  }

  /** The text on the screen and in the scrollback. */
  screen(): string {
    const buffer = this.#terminal.buffer.active;
    return Array.from({ length: buffer.length }, (_, i) =>
      buffer.getLine(i)?.translateToString(true),
    )
      .join("\n")
      .trimEnd();
  }

  /** Waits until the screen contains `text`, and returns the screen. */
  async waitFor(text: string, deadline = Date.now() + TIMEOUT_MS): Promise<string> {
    if (this.screen().includes(text)) return this.screen();
    if (this.#stopped(deadline)) throw new Error(`no "${text}" on screen:\n${this.screen()}`);
    await Bun.sleep(50);
    return this.waitFor(text, deadline);
  }

  /** Writes keys to the terminal. Use `\r` for Enter and `\x1b` for Escape. */
  type(keys: string): void {
    this.#proc.terminal?.write(keys);
  }

  /**
   * Waits until pi is ready, types the text, and presses Enter. Pi takes text and Enter in one
   * write as a paste, so this writes them separately. Pi keeps the text in the editor if it gets
   * Enter before startup is complete. Then this presses Enter again.
   */
  async submit(text: string): Promise<void> {
    await this.waitFor(this.ready);
    this.type(text);
    await Bun.sleep(100);
    return this.#enter(Date.now() + TIMEOUT_MS);
  }

  async #enter(deadline: number): Promise<void> {
    this.type("\r");
    await Bun.sleep(300);
    if (!this.screen().includes(STARTUP_BUSY)) return;
    if (Date.now() > deadline) throw new Error(`pi did not start:\n${this.screen()}`);
    return this.#enter(deadline);
  }

  #stopped(deadline: number): boolean {
    return this.#proc.exitCode !== null || Date.now() > deadline;
  }

  /** Stops pi. */
  async stop(): Promise<void> {
    this.#proc.kill();
    await this.#proc.exited;
    this.#terminal.dispose();
  }
}
