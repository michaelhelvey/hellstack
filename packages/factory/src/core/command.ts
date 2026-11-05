import { execFile, type ExecFileException } from "node:child_process";

/** The exit code and output of a finished command. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `program` with `args` and returns its result. It must reject when the program cannot start
 * or does not finish in `timeoutMs`. Tests give a fake runner.
 */
export type CommandRunner = (
  program: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>;

function exitCode(error: ExecFileException | null): number | undefined {
  if (!error) return 0;
  return typeof error.code === "number" ? error.code : undefined;
}

/**
 * Runs a command with `child_process.execFile`. A nonzero exit code does not reject. The command gets
 * an empty stdin, so that programs such as `pi -p` do not wait for input.
 */
export function runCommand(
  program: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const options = { timeout: timeoutMs, encoding: "utf8" } as const;
    const child = execFile(program, args, options, (error, stdout, stderr) => {
      const code = exitCode(error);
      if (code === undefined) reject(new Error(`${program} failed: ${error?.message}`));
      else resolve({ code, stdout, stderr });
    });
    child.stdin?.end();
  });
}
