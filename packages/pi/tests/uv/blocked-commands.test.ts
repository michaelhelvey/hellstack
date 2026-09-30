import { expect, test } from "bun:test";

import { findBlockedCommandMessage } from "../../src/uv/blocked-commands.ts";

test.each([
  ["pip install requests", "pip is disabled"],
  ["pip3 install requests", "pip3 is disabled"],
  ["cd app && poetry add requests", "poetry is disabled"],
  ["ls; .venv/bin/python3.12 -m pip install x", "'python -m pip' is disabled"],
  ["python -mvenv .venv", "'python -m venv' is disabled"],
  ["echo ok\npython3 -m py_compile main.py", "'python -m py_compile' is disabled"],
])("findBlockedCommandMessage blocks %p", (command, expected) => {
  expect(findBlockedCommandMessage(command)).toContain(expected);
});

test.each([
  "uv pip install requests",
  "uv run python main.py",
  "echo pip",
  "grep -r pipeline src",
  "python -m pytest",
])("findBlockedCommandMessage permits %p", (command) => {
  expect(findBlockedCommandMessage(command)).toBeUndefined();
});
