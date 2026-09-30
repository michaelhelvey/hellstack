const SEGMENT_START = String.raw`(?:^|\n|[;|&]{1,2})\s*(?:\S+\/)?`;
const PYTHON = String.raw`python(?:3(?:\.\d+)?)?\b[^\n;|&]*`;

function commandPattern(name: string): RegExp {
  return new RegExp(String.raw`${SEGMENT_START}${name}\s*(?:$|\s)`, "m");
}

function pythonModulePattern(module: string): RegExp {
  return new RegExp(
    String.raw`${SEGMENT_START}${PYTHON}(?:\s-m\s*${module}\b|\s-m${module}\b)`,
    "m",
  );
}

const INSTALL_HINTS = [
  "  To install a package for a script: uv run --with PACKAGE python script.py",
  "  To add a dependency to the project: uv add PACKAGE",
];

const BLOCKED_COMMANDS: ReadonlyArray<{ pattern: RegExp; lines: string[] }> = [
  {
    pattern: commandPattern("pip"),
    lines: ["Error: pip is disabled. Use uv instead:", ...INSTALL_HINTS],
  },
  {
    pattern: commandPattern("pip3"),
    lines: ["Error: pip3 is disabled. Use uv instead:", ...INSTALL_HINTS],
  },
  {
    pattern: commandPattern("poetry"),
    lines: [
      "Error: poetry is disabled. Use uv instead:",
      "  To initialize a project: uv init",
      "  To add a dependency: uv add PACKAGE",
      "  To sync dependencies: uv sync",
      "  To run commands: uv run COMMAND",
    ],
  },
  {
    pattern: pythonModulePattern("pip"),
    lines: ["Error: 'python -m pip' is disabled. Use uv instead:", ...INSTALL_HINTS],
  },
  {
    pattern: pythonModulePattern("venv"),
    lines: [
      "Error: 'python -m venv' is disabled. Use uv instead:",
      "  To create a virtual environment: uv venv",
    ],
  },
  {
    pattern: pythonModulePattern("py_compile"),
    lines: [
      "Error: 'python -m py_compile' is disabled because it writes .pyc files to __pycache__.",
      "  To verify syntax without bytecode output: uv run python -m ast path/to/file.py >/dev/null",
    ],
  },
];

/**
 * Finds the first Python tool invocation in a shell command that must use uv instead.
 * Returns the error message for that invocation, or undefined if the command is permitted.
 */
export function findBlockedCommandMessage(command: string): string | undefined {
  const blocked = BLOCKED_COMMANDS.find(({ pattern }) => pattern.test(command));
  if (!blocked) return undefined;
  const [heading, ...hints] = blocked.lines;
  return [heading, "", ...hints, ""].join("\n");
}
